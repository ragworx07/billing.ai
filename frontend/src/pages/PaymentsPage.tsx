import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Navigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Download,
  Eye,
  FileCheck,
  FileText,
  Filter,
  Layers,
  MoreVertical,
  Percent,
  Plus,
  Printer,
  Receipt,
  Search,
  Share2,
  SlidersHorizontal,
  FileSpreadsheet,
  Trash2,
  UserCheck,
  Users2,
  Wallet,
  X,
} from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

import kkrLogo from '../assets/kkr-logo.png';
import { DataTable } from '../components/DataTable';
import { JVBillPDF } from '../components/JVBillPDF';
import { ESignImageUpload } from '../components/ESignImageUpload';
import { RequiredLabel } from '../components/RequiredLabel';
import { SearchableSelect } from '../components/SearchableSelect';
import { SectionCard } from '../components/SectionCard';
import { PageSkeleton } from '../components/Skeleton';
import { useAuth } from '../contexts/AuthContext';
import { useNotify } from '../contexts/NotificationContext';
import { api } from '../services/api';
import type {
  Bill,
  BillInput,
  BillItemInput,
  JVProjectSummaryItem,
  JVShareholderPaymentEntry,
  ProjectShareholder,
} from '../types/api';
import { hasPermission } from '../utils/access';
import { getApiErrorMessage } from '../utils/errors';
import {
  billingEntityLabel,
  billDateValue,
  exportGstInvoiceRegisterExcel,
  type GstInvoiceExcelBreakdown,
} from '../utils/exportGstInvoicesExcel';
import { formatCurrency, formatDate, localDateKey, addDaysToDateKey } from '../utils/format';

type WorkspaceView = 'bills' | 'payments';
type SortMode = 'latest' | 'oldest' | 'amount_desc' | 'amount_asc' | 'project_az' | 'shareholder_az';

type PaymentLedgerRow = {
  id: number;
  project_id: number;
  shareholder_id: number;
  project_name: string;
  client_name: string;
  shareholder_name: string;
  company_name: string | null;
  pan_no: string | null;
  payment_date: string;
  amount: number;
  payment_mode: string | null;
  notes: string | null;
  month_key: string;
  search_text: string;
};

const initialBillItem: BillItemInput = {
  description: '',
  hsn_code: '995411',
  cgst_rate: 2.5,
  sgst_rate: 2.5,
  cgst_amount: 0,
  sgst_amount: 0,
  quantity: 1,
  rate: 0,
  amount: 0,
};

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function getBillGstSplit(bill: Bill) {
  const itemCgst = (bill.items || []).reduce((sum, item) => sum + Number(item.cgst_amount || 0), 0);
  const itemSgst = (bill.items || []).reduce((sum, item) => sum + Number(item.sgst_amount || 0), 0);
  const cgst = Number(bill.cgst_amount || 0) || itemCgst;
  const sgst = Number(bill.sgst_amount || 0) || itemSgst;
  const gst = cgst + sgst || Number(bill.tax_amount || 0);
  if (cgst + sgst === 0 && gst > 0) {
    return { cgst: gst / 2, sgst: gst / 2, gst };
  }
  return { cgst, sgst, gst: cgst + sgst };
}

function getBillGstRateInfo(bill: Bill) {
  const split = getBillGstSplit(bill);
  const itemsWithRate = (bill.items || []).filter(
    (i) => i.cgst_rate !== undefined || i.sgst_rate !== undefined
  );
  let cgstRate = 2.5;
  let sgstRate = 2.5;
  let totalRate = 5;

  if (itemsWithRate.length > 0) {
    cgstRate = Number(itemsWithRate[0].cgst_rate ?? 2.5);
    sgstRate = Number(itemsWithRate[0].sgst_rate ?? 2.5);
    totalRate = cgstRate + sgstRate;
  } else if (bill.subtotal > 0 && split.gst > 0) {
    const calcRate = (split.gst / bill.subtotal) * 100;
    totalRate = Number(calcRate.toFixed(1));
    cgstRate = Number((totalRate / 2).toFixed(1));
    sgstRate = Number((totalRate / 2).toFixed(1));
  }

  return { ...split, cgstRate, sgstRate, totalRate };
}

const GST_SIGNATURE_STORAGE_KEY = 'cido_gst_invoice_signature';

function readStoredGstSignature() {
  try {
    return localStorage.getItem(GST_SIGNATURE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredGstSignature(value: string | null) {
  try {
    if (value) localStorage.setItem(GST_SIGNATURE_STORAGE_KEY, value);
    else localStorage.removeItem(GST_SIGNATURE_STORAGE_KEY);
  } catch {
    // ignore quota or private-mode failures
  }
}

function toBillInput(bill: Bill, signatureImage: string | null): BillInput {
  return {
    bill_number: bill.bill_number,
    project_id: bill.project_id || 0,
    custom_project_name: bill.custom_project_name || null,
    shareholder_id: bill.shareholder_id || null,
    bill_date: bill.bill_date,
    due_date: bill.due_date,
    client_name: bill.client_name,
    company_name: bill.company_name || null,
    billing_address: bill.billing_address || null,
    billing_city: bill.billing_city || null,
    billing_pincode: bill.billing_pincode || null,
    seal_type: bill.seal_type,
    subtotal: bill.subtotal,
    cgst_amount: bill.cgst_amount || 0,
    sgst_amount: bill.sgst_amount || 0,
    tax_amount: bill.tax_amount,
    discount_amount: bill.discount_amount,
    total_amount: bill.total_amount,
    notes: bill.notes || null,
    signature_image: signatureImage,
    gst_only: Boolean(bill.gst_only),
    items: (bill.items || []).map((item) => ({
      description: item.description,
      hsn_code: item.hsn_code || '995411',
      cgst_rate: item.cgst_rate ?? 2.5,
      sgst_rate: item.sgst_rate ?? 2.5,
      cgst_amount: item.cgst_amount || 0,
      sgst_amount: item.sgst_amount || 0,
      quantity: item.quantity,
      rate: item.rate,
      amount: item.amount,
    })),
  };
}

const initialBillForm = {
  bill_number: '',
  is_custom_project: false,
  project_id: 0,
  custom_project_name: '',
  is_custom_client: false,
  shareholder_id: 0,
  client_name: '',
  company_name: '',
  billing_address: '',
  billing_city: '',
  billing_pincode: '',
  bill_date: localDateKey(),
  due_date: addDaysToDateKey(localDateKey(), 15),
  seal_type: 'developers',
  tax_amount: 0,
  discount_amount: 0,
  notes: '',
  signature_image: '',
  gst_only: false,
  items: [
    { description: 'Payment', hsn_code: '995411', cgst_rate: 2.5, sgst_rate: 2.5, cgst_amount: 0, sgst_amount: 0, quantity: 1, rate: 0, amount: 0 },
  ] as BillItemInput[],
};

export function GSTInvoicesPage() {
  return <BillingWorkspace view="bills" />;
}

export function PaymentsPage() {
  const [searchParams] = useSearchParams();
  if (searchParams.get('tab') === 'bills') {
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    const qs = next.toString();
    return <Navigate to={qs ? `/gst-invoices?${qs}` : '/gst-invoices'} replace />;
  }
  return <BillingWorkspace view="payments" />;
}

function BillingWorkspace({ view }: { view: WorkspaceView }) {
  const { user } = useAuth();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const shareholderIdParam = searchParams.get('shareholderId');
  const projectIdParam = searchParams.get('projectId');
  const [projectFilter, setProjectFilter] = useState<'all' | string>(() => projectIdParam || 'all');
  const [clientFilter, setClientFilter] = useState('');
  const [shareholderFilter, setShareholderFilter] = useState<'all' | string>(() => shareholderIdParam || 'all');
  const [billStatusFilter, setBillStatusFilter] = useState<string>('all');
  const [monthFilter, setMonthFilter] = useState<'all' | string>('all');
  const [modeFilter, setModeFilter] = useState<'all' | string>('all');
  const [sortMode, setSortMode] = useState<SortMode>('latest');

  // Bill Drawer & PDF State
  const [billDrawerOpen, setBillDrawerOpen] = useState(false);
  const [editingBillId, setEditingBillId] = useState<number | null>(null);
  const [billForm, setBillForm] = useState(initialBillForm);
  const [viewingBill, setViewingBill] = useState<Bill | null>(null);
  const [previewBill, setPreviewBill] = useState<Bill | null>(null);
  const [recordPaymentBill, setRecordPaymentBill] = useState<Bill | null>(null);

  // Record Payment Modal Form State
  const [recordPaymentForm, setRecordPaymentForm] = useState({
    payment_date: localDateKey(),
    amount: 0,
    payment_mode: 'cash',
    notes: '',
  });
  const [exportingExcel, setExportingExcel] = useState(false);
  const [billRowMenu, setBillRowMenu] = useState<{ billId: number; top: number; left: number } | null>(null);
  const billRowMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!billRowMenu) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (billRowMenuRef.current?.contains(event.target as Node)) return;
      setBillRowMenu(null);
    };
    const handleScroll = () => setBillRowMenu(null);
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [billRowMenu]);

  function toggleBillRowMenu(event: React.MouseEvent<HTMLButtonElement>, billId: number) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 190;
    const menuHeight = 220;
    const gap = 6;
    const left = Math.min(
      Math.max(8, rect.right - menuWidth),
      window.innerWidth - menuWidth - 8,
    );
    const fitsBelow = rect.bottom + gap + menuHeight <= window.innerHeight - 8;
    const top = fitsBelow
      ? rect.bottom + gap
      : Math.max(8, rect.top - menuHeight - gap);
    setBillRowMenu((current) => (
      current?.billId === billId ? null : { billId, top, left }
    ));
  }

  const billPrintRef = useRef<HTMLDivElement>(null);
  const canPaymentEntry = hasPermission(user?.role, 'tab_payments');
  const canManageInvoices = hasPermission(user?.role, 'gst_invoice_manage');
  const canExportInvoices = hasPermission(user?.role, 'gst_invoice_export');
  const canGstBilling = hasPermission(user?.role, 'client_gst_billing');

  const { data: jvProjects = [] } = useQuery({
    queryKey: ['jv-projects'],
    queryFn: () => api.getJVProjects(),
  });

  const { data: clientPayments = [], isLoading: isLoadingPayments } = useQuery({
    queryKey: ['client-payments'],
    queryFn: () => api.getJVShareholderPayments(),
    enabled: view === 'payments',
  });

  const { data: bills = [], isLoading: isLoadingBills } = useQuery({
    queryKey: ['bills'],
    queryFn: () => api.getBills(),
    enabled: view === 'bills',
  });

  const { data: nextBillNumber } = useQuery({
    queryKey: ['next-bill-number'],
    queryFn: async () => (await api.getNextBillNumber()).bill_number,
    enabled: view === 'bills',
  });

  // Selected project shareholders for bill form
  const { data: projectShareholders = [] } = useQuery({
    queryKey: ['project-shareholders', billForm.project_id],
    queryFn: () => (billForm.project_id > 0 ? api.getProjectShareholders(billForm.project_id) : Promise.resolve([])),
    enabled: billForm.project_id > 0,
  });

  useEffect(() => {
    if (projectIdParam) setProjectFilter(projectIdParam);
    if (shareholderIdParam) setShareholderFilter(shareholderIdParam);
  }, [projectIdParam, shareholderIdParam]);

  useEffect(() => {
    if (!billDrawerOpen || editingBillId || !nextBillNumber) return;
    setBillForm((prev) => {
      if (prev.bill_number.trim()) return prev;
      return { ...prev, bill_number: nextBillNumber };
    });
  }, [billDrawerOpen, editingBillId, nextBillNumber]);

  // Mutations
  const saveBillMutation = useMutation({
    mutationFn: async (input: BillInput) => {
      if (editingBillId) {
        return api.updateBill(editingBillId, input);
      }
      return api.createBill(input);
    },
    onSuccess: (_data, input) => {
      writeStoredGstSignature(input.signature_image || null);
      void queryClient.invalidateQueries({ queryKey: ['bills'] });
      void queryClient.invalidateQueries({ queryKey: ['next-bill-number'] });
      notify.success(editingBillId ? 'Bill updated successfully!' : 'Bill created successfully!');
      setBillDrawerOpen(false);
      setEditingBillId(null);
      setBillForm({ ...initialBillForm, signature_image: input.signature_image || '' });
    },
    onError: (err) => {
      notify.error(getApiErrorMessage(err, 'Failed to save bill.'));
    },
  });

  const saveSignatureMutation = useMutation({
    mutationFn: async ({ bill, signatureImage }: { bill: Bill; signatureImage: string | null }) => {
      return api.updateBill(bill.id, toBillInput(bill, signatureImage));
    },
    onSuccess: (updated) => {
      writeStoredGstSignature(updated.signature_image || null);
      void queryClient.invalidateQueries({ queryKey: ['bills'] });
      setPreviewBill(updated);
      setViewingBill((current) => (current?.id === updated.id ? updated : current));
      notify.success(updated.signature_image ? 'Signature added to this invoice.' : 'Signature removed from this invoice.');
    },
    onError: (err) => {
      notify.error(getApiErrorMessage(err, 'Failed to save signature.'));
    },
  });

  const deleteBillMutation = useMutation({
    mutationFn: (billId: number) => api.deleteBill(billId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bills'] });
      notify.success('Bill deleted successfully.');
    },
    onError: (err) => {
      notify.error(getApiErrorMessage(err, 'Failed to delete bill.'));
    },
  });

  const deletePaymentMutation = useMutation({
    mutationFn: (paymentId: number) => {
      const target = clientPayments.find((item) => item.id === paymentId);
      const pId = target?.project_id || 0;
      return api.deleteJVShareholderPayment(pId, paymentId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['client-payments'] });
      void queryClient.invalidateQueries({ queryKey: ['jv-project-ledger'] });
      void queryClient.invalidateQueries({ queryKey: ['bills'] });
      notify.success('Payment entry deleted.');
    },
    onError: (err) => {
      notify.error(getApiErrorMessage(err, 'Failed to delete payment.'));
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async ({ billId, payload }: { billId: number; payload: typeof recordPaymentForm }) => {
      return api.recordBillPayment(billId, payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bills'] });
      void queryClient.invalidateQueries({ queryKey: ['client-payments'] });
      void queryClient.invalidateQueries({ queryKey: ['jv-project-ledger'] });
      notify.success('Payment recorded and receipt generated!');
      setRecordPaymentBill(null);
    },
    onError: (err) => {
      notify.error(getApiErrorMessage(err, 'Failed to record payment.'));
    },
  });

  // Calculate Subtotal & Taxes for Bill Form
  const calculatedSubtotal = useMemo(() => {
    return billForm.items.reduce((sum, item) => sum + Number(item.amount || (item.quantity * item.rate) || 0), 0);
  }, [billForm.items]);

  const calculatedCgstAmount = useMemo(() => {
    return billForm.items.reduce((sum, item) => {
      const base = Number(item.amount || (item.quantity * item.rate) || 0);
      const rate = item.cgst_rate ?? 2.5;
      return sum + roundMoney((base * rate) / 100);
    }, 0);
  }, [billForm.items]);

  const calculatedSgstAmount = useMemo(() => {
    return billForm.items.reduce((sum, item) => {
      const base = Number(item.amount || (item.quantity * item.rate) || 0);
      const rate = item.sgst_rate ?? 2.5;
      return sum + roundMoney((base * rate) / 100);
    }, 0);
  }, [billForm.items]);

  const calculatedTotalAmount = useMemo(() => {
    const sub = calculatedSubtotal;
    const cgst = calculatedCgstAmount;
    const sgst = calculatedSgstAmount;
    const disc = Number(billForm.discount_amount || 0);
    return Math.max(0, sub + cgst + sgst - disc);
  }, [calculatedCgstAmount, calculatedSgstAmount, calculatedSubtotal, billForm.discount_amount]);

  function handleProjectChangeForBill(projectId: number) {
    setBillForm((prev) => ({
      ...prev,
      is_custom_project: false,
      project_id: projectId,
      custom_project_name: '',
      is_custom_client: false,
      shareholder_id: 0,
      client_name: '',
      company_name: '',
      billing_address: '',
      billing_city: '',
      billing_pincode: '',
    }));
  }

  function handleClientSelectForBill(shareholderId: number) {
    const sh = projectShareholders.find((s) => s.id === shareholderId);
    if (!sh) {
      setBillForm((prev) => ({ ...prev, shareholder_id: 0 }));
      return;
    }
    setBillForm((prev) => ({
      ...prev,
      is_custom_client: false,
      shareholder_id: sh.id,
      client_name: sh.name,
      company_name: sh.company_name || sh.pan_no || '',
      billing_address: sh.address || '',
      billing_city: sh.city || '',
      billing_pincode: sh.pincode || '',
    }));
  }

  function handleBillItemChange(index: number, field: keyof BillItemInput, val: string | number) {
    setBillForm((prev) => {
      const nextItems = [...prev.items];
      const item = { ...nextItems[index] };
      if (field === 'description') {
        item.description = String(val);
      } else if (field === 'hsn_code') {
        item.hsn_code = String(val);
      } else if (field === 'cgst_rate') {
        item.cgst_rate = Number(val || 0);
      } else if (field === 'sgst_rate') {
        item.sgst_rate = Number(val || 0);
      } else if (field === 'quantity') {
        item.quantity = Number(val || 0);
        item.amount = Number((item.quantity * item.rate).toFixed(2));
      } else if (field === 'rate') {
        item.rate = Number(val || 0);
        item.amount = Number((item.quantity * item.rate).toFixed(2));
      } else if (field === 'amount') {
        item.amount = Number(val || 0);
      }
      const base = item.amount || (item.quantity * item.rate) || 0;
      item.cgst_amount = roundMoney((base * (item.cgst_rate ?? 2.5)) / 100);
      item.sgst_amount = roundMoney((base * (item.sgst_rate ?? 2.5)) / 100);
      nextItems[index] = item;
      return { ...prev, items: nextItems };
    });
  }

  function addBillItemRow() {
    setBillForm((prev) => ({ ...prev, items: [...prev.items, { ...initialBillItem }] }));
  }

  function removeBillItemRow(index: number) {
    setBillForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  }

  function openCreateBillDrawer() {
    setEditingBillId(null);
    setBillForm({ ...initialBillForm, signature_image: readStoredGstSignature() || '' });
    setBillDrawerOpen(true);
  }

  function openEditBillDrawer(bill: Bill) {
    const isCustomProj = !bill.project_id || bill.project_id <= 0;
    const isCustomCli = !bill.shareholder_id || bill.shareholder_id <= 0;
    setEditingBillId(bill.id);
    setBillForm({
      bill_number: bill.bill_number || '',
      is_custom_project: isCustomProj,
      project_id: bill.project_id || 0,
      custom_project_name: bill.custom_project_name || (!bill.project_id ? (bill.project_name || '') : ''),
      is_custom_client: isCustomCli,
      shareholder_id: bill.shareholder_id || 0,
      bill_date: bill.bill_date,
      due_date: bill.due_date,
      client_name: bill.client_name,
      company_name: bill.company_name || '',
      billing_address: bill.billing_address || '',
      billing_city: bill.billing_city || '',
      billing_pincode: bill.billing_pincode || '',
      seal_type: bill.seal_type || 'developers',
      tax_amount: bill.tax_amount || 0,
      discount_amount: bill.discount_amount || 0,
      notes: bill.notes || '',
      signature_image: bill.signature_image || readStoredGstSignature() || '',
      gst_only: Boolean(bill.gst_only),
      items: (bill.items || []).map((i) => ({
        description: i.description,
        hsn_code: i.hsn_code || '995411',
        cgst_rate: i.cgst_rate ?? 2.5,
        sgst_rate: i.sgst_rate ?? 2.5,
        cgst_amount: i.cgst_amount || 0,
        sgst_amount: i.sgst_amount || 0,
        quantity: i.quantity,
        rate: i.rate,
        amount: i.amount,
      })),
    });
    setBillDrawerOpen(true);
  }

  function submitBillForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!billForm.is_custom_project && !billForm.project_id) {
      notify.error('Please select an existing project or enter a custom project name.');
      return;
    }
    if (billForm.is_custom_project && !billForm.custom_project_name.trim()) {
      notify.error('Please enter a custom project name.');
      return;
    }
    if (!billForm.client_name.trim()) {
      notify.error('Client name is required.');
      return;
    }
    if (!billForm.items.length || billForm.items.some((i) => !i.description.trim())) {
      notify.error('Please provide at least one valid item description.');
      return;
    }

    const payload: BillInput = {
      bill_number: billForm.bill_number.trim() || null,
      project_id: billForm.is_custom_project ? 0 : billForm.project_id,
      custom_project_name: billForm.is_custom_project ? billForm.custom_project_name.trim() : null,
      shareholder_id: (!billForm.is_custom_project && !billForm.is_custom_client) ? (billForm.shareholder_id || null) : null,
      bill_date: billForm.bill_date,
      due_date: billForm.due_date,
      client_name: billForm.client_name.trim(),
      company_name: billForm.company_name.trim() || null,
      billing_address: billForm.billing_address.trim() || null,
      billing_city: billForm.billing_city.trim() || null,
      billing_pincode: billForm.billing_pincode.trim() || null,
      seal_type: billForm.seal_type,
      subtotal: calculatedSubtotal,
      cgst_amount: calculatedCgstAmount,
      sgst_amount: calculatedSgstAmount,
      tax_amount: calculatedCgstAmount + calculatedSgstAmount,
      discount_amount: Number(billForm.discount_amount || 0),
      total_amount: calculatedTotalAmount,
      notes: billForm.notes.trim() || null,
      signature_image: billForm.signature_image.trim() || null,
      gst_only: Boolean(billForm.gst_only),
      items: billForm.items.map((i) => {
        const base = Number(i.amount || (i.quantity * i.rate) || 0);
        const cgstRate = i.cgst_rate ?? 2.5;
        const sgstRate = i.sgst_rate ?? 2.5;
        const cgstAmt = roundMoney((base * cgstRate) / 100);
        const sgstAmt = roundMoney((base * sgstRate) / 100);
        return {
          description: i.description.trim(),
          hsn_code: i.hsn_code || '995411',
          cgst_rate: cgstRate,
          sgst_rate: sgstRate,
          cgst_amount: cgstAmt,
          sgst_amount: sgstAmt,
          quantity: Number(i.quantity || 1),
          rate: Number(i.rate || 0),
          amount: base,
        };
      }),
    };

    saveBillMutation.mutate(payload);
  }

  function openRecordPaymentModal(bill: Bill) {
    setRecordPaymentBill(bill);
    setRecordPaymentForm({
      payment_date: localDateKey(),
      amount: bill.balance_amount || bill.total_amount,
      payment_mode: 'cash',
      notes: `Bill payment for ${bill.bill_number}`,
    });
  }

  async function exportBillPDF(action: 'download' | 'share' | 'print', bill: Bill) {
    setViewingBill(bill);
    setTimeout(async () => {
      const el = billPrintRef.current;
      if (!el) return;
      if (action === 'print') {
        window.print();
        return;
      }

      try {
        const canvas = await html2canvas(el, { scale: 2, useCORS: true });
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);

        const filename = `Bill_${bill.bill_number}.pdf`;
        if (action === 'download') {
          pdf.save(filename);
          notify.success(`Bill ${bill.bill_number} PDF downloaded!`);
        } else if (action === 'share' && navigator.share) {
          const blob = pdf.output('blob');
          const file = new File([blob], filename, { type: 'application/pdf' });
          await navigator.share({ files: [file], title: `Bill ${bill.bill_number}` });
        }
      } catch (err) {
        notify.error('Unable to export Bill PDF.');
      }
    }, 200);
  }

  // Filtered Bills Data
  const filteredBills = useMemo(() => {
    return bills.filter((b) => {
      if (projectFilter !== 'all' && String(b.project_id) !== projectFilter) return false;
      if (shareholderFilter !== 'all' && String(b.shareholder_id) !== shareholderFilter) return false;
      if (billStatusFilter !== 'all' && b.status !== billStatusFilter) return false;
      if (clientFilter.trim()) {
        const search = clientFilter.toLowerCase();
        const clientMatch = b.client_name.toLowerCase().includes(search);
        const billNumMatch = b.bill_number.toLowerCase().includes(search);
        const projMatch = (b.project_name || '').toLowerCase().includes(search);
        if (!clientMatch && !billNumMatch && !projMatch) return false;
      }
      return true;
    });
  }, [bills, projectFilter, shareholderFilter, billStatusFilter, clientFilter]);

  // Bill KPI Summary
  const billSummary = useMemo(() => {
    return filteredBills.reduce(
      (acc, bill) => {
        const split = getBillGstSplit(bill);
        acc.taxable += Number(bill.subtotal || 0);
        acc.cgst += split.cgst;
        acc.sgst += split.sgst;
        acc.gst += split.gst;
        acc.totalBilled += Number(bill.total_amount || 0);
        acc.totalPaid += Number(bill.paid_amount || 0);
        acc.totalBalance += Number(bill.balance_amount || 0);
        acc.count += 1;
        if (bill.status === 'unpaid' && new Date(bill.due_date) < new Date()) acc.overdueCount += 1;
        return acc;
      },
      {
        taxable: 0,
        cgst: 0,
        sgst: 0,
        gst: 0,
        totalBilled: 0,
        totalPaid: 0,
        totalBalance: 0,
        overdueCount: 0,
        count: 0,
      },
    );
  }, [filteredBills]);

  // Payment Register Data Preparation
  const paymentRows = useMemo<PaymentLedgerRow[]>(() => {
    return clientPayments.map((payment: JVShareholderPaymentEntry) => {
      const monthKey = payment.payment_date ? payment.payment_date.slice(0, 7) : 'Unknown';
      const searchText = [
        payment.project_name,
        payment.client_name,
        payment.shareholder_name,
        payment.company_name,
        payment.pan_no,
        payment.payment_mode,
        payment.notes,
        formatDate(payment.payment_date),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return {
        id: payment.id,
        project_id: payment.project_id,
        shareholder_id: payment.shareholder_id,
        project_name: payment.project_name,
        client_name: payment.client_name,
        shareholder_name: payment.shareholder_name,
        company_name: payment.company_name || null,
        pan_no: payment.pan_no || null,
        payment_date: payment.payment_date,
        amount: Number(payment.amount || 0),
        payment_mode: payment.payment_mode || null,
        notes: payment.notes || null,
        month_key: monthKey,
        search_text: searchText,
      };
    });
  }, [clientPayments]);

  const availableProjectOptions = useMemo(() => {
    const map = new Map<number, { id: number; project_name: string }>();
    jvProjects.forEach((p) => map.set(p.project_id, { id: p.project_id, project_name: p.project_name }));
    return Array.from(map.values()).sort((a, b) => a.project_name.localeCompare(b.project_name));
  }, [jvProjects]);

  const availableShareholderOptions = useMemo(() => {
    const map = new Map<number, { id: number; label: string }>();
    paymentRows.forEach((r) => {
      const label = r.company_name ? `${r.shareholder_name} (${r.company_name})` : r.shareholder_name;
      map.set(r.shareholder_id, { id: r.shareholder_id, label });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [paymentRows]);

  const availableMonthOptions = useMemo(() => {
    const set = new Set<string>();
    paymentRows.forEach((r) => set.add(r.month_key));
    return Array.from(set).sort().reverse();
  }, [paymentRows]);

  const filteredPayments = useMemo(() => {
    const search = clientFilter.trim().toLowerCase();
    const result = paymentRows.filter((r) => {
      if (projectFilter !== 'all' && String(r.project_id) !== projectFilter) return false;
      if (shareholderFilter !== 'all' && String(r.shareholder_id) !== shareholderFilter) return false;
      if (monthFilter !== 'all' && r.month_key !== monthFilter) return false;
      if (modeFilter !== 'all' && (r.payment_mode || 'cash').toLowerCase() !== modeFilter.toLowerCase()) return false;
      if (search && !r.search_text.includes(search)) return false;
      return true;
    });

    return result.sort((a, b) => {
      if (sortMode === 'latest') return new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime() || b.id - a.id;
      if (sortMode === 'oldest') return new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime() || a.id - b.id;
      if (sortMode === 'amount_desc') return b.amount - a.amount;
      if (sortMode === 'amount_asc') return a.amount - b.amount;
      if (sortMode === 'project_az') return a.project_name.localeCompare(b.project_name);
      return a.shareholder_name.localeCompare(b.shareholder_name);
    });
  }, [clientFilter, modeFilter, monthFilter, paymentRows, projectFilter, shareholderFilter, sortMode]);

  const paymentSummary = useMemo(() => {
    const totalAmount = filteredPayments.reduce((sum, r) => sum + r.amount, 0);
    const projectSet = new Set(filteredPayments.map((r) => r.project_id));
    const clientSet = new Set(filteredPayments.map((r) => r.shareholder_id));
    const monthLabel = monthFilter === 'all' ? 'All Months' : monthFilter;
    return { totalAmount, projectCount: projectSet.size, clientCount: clientSet.size, monthLabel };
  }, [filteredPayments, monthFilter]);

  async function handleExportGstExcel() {
    setExportingExcel(true);
    try {
      const emptyBreakdown = (): GstInvoiceExcelBreakdown => ({
        label: '',
        count: 0,
        taxable: 0,
        gst: 0,
        billTotal: 0,
        paid: 0,
        balance: 0,
      });
      const bump = (item: GstInvoiceExcelBreakdown, bill: Bill, split: ReturnType<typeof getBillGstSplit>) => {
        item.count += 1;
        item.taxable += Number(bill.subtotal || 0);
        item.gst += split.gst;
        item.billTotal += Number(bill.total_amount || 0);
        item.paid += Number(bill.paid_amount || 0);
        item.balance += Number(bill.balance_amount || 0);
      };

      const byStatusMap = new Map<string, GstInvoiceExcelBreakdown>();
      ['unpaid', 'partial', 'paid'].forEach((status) => {
        byStatusMap.set(status, { ...emptyBreakdown(), label: status });
      });
      const byProjectMap = new Map<string, GstInvoiceExcelBreakdown>();

      const excelRows = filteredBills.map((bill, index) => {
        const split = getBillGstSplit(bill);
        const status = (bill.status || 'unpaid').toLowerCase();
        const project = bill.project_name || bill.custom_project_name || '-';
        const statusItem = byStatusMap.get(status) || { ...emptyBreakdown(), label: status };
        bump(statusItem, bill, split);
        byStatusMap.set(status, statusItem);
        const projectItem = byProjectMap.get(project) || { ...emptyBreakdown(), label: project };
        bump(projectItem, bill, split);
        byProjectMap.set(project, projectItem);

        return {
          sno: index + 1,
          billNumber: bill.bill_number,
          billDate: billDateValue(bill.bill_date),
          dueDate: billDateValue(bill.due_date),
          project,
          client: bill.client_name || '-',
          pan: bill.company_name || '-',
          entity: billingEntityLabel(bill.seal_type),
          taxable: Number(bill.subtotal || 0),
          cgst: split.cgst,
          sgst: split.sgst,
          gst: split.gst,
          billTotal: Number(bill.total_amount || 0),
          paid: Number(bill.paid_amount || 0),
          balance: Number(bill.balance_amount || 0),
          status,
        };
      });

      const projectLabel =
        projectFilter === 'all'
          ? 'All projects'
          : `Project: ${availableProjectOptions.find((p) => String(p.id) === projectFilter)?.project_name || projectFilter}`;
      const statusLabel =
        billStatusFilter === 'all'
          ? 'All statuses'
          : `Status: ${billStatusFilter.charAt(0).toUpperCase()}${billStatusFilter.slice(1)}`;
      const searchLabel = clientFilter.trim() ? `Search: ${clientFilter.trim()}` : '';

      const savedPath = await exportGstInvoiceRegisterExcel({
        rows: excelRows,
        summary: billSummary,
        filters: [projectLabel, statusLabel, searchLabel],
        byStatus: ['unpaid', 'partial', 'paid']
          .map((status) => byStatusMap.get(status))
          .filter((item): item is GstInvoiceExcelBreakdown => Boolean(item)),
        byProject: Array.from(byProjectMap.values()).sort((a, b) => a.label.localeCompare(b.label)),
      });
      notify.success(savedPath ? `Excel saved to ${savedPath}` : 'GST invoice register exported to Excel.');
      void api.recordAuditEvent({
        action: 'export',
        table_name: 'bills',
        record_id: 1,
        details: `Exported ${excelRows.length} GST invoice${excelRows.length === 1 ? '' : 's'} to Excel`,
      }).catch(() => undefined);
    } catch {
      notify.error('Unable to export Excel.');
    } finally {
      setExportingExcel(false);
    }
  }

  if ((view === 'payments' && isLoadingPayments) || (view === 'bills' && isLoadingBills)) {
    return <PageSkeleton title cards={4} tableRows={8} />;
  }

  return (
    <div className="min-w-0 space-y-6">
      {/* Header & Page Title */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-clay">
            {view === 'bills' ? 'Vouchers · Sales (F8)' : 'Vouchers · Receipts (F6)'}
          </p>
          <h1 className="mt-1 font-display text-3xl text-graphite">
            {view === 'bills' ? 'Sales Invoices (GST Billing)' : 'Receipts & Payments'}
          </h1>
          <p className="mt-1 max-w-2xl text-sm font-medium text-slate-500">
            {view === 'bills'
              ? 'Create GST tax invoices, track billed totals with CGST/SGST split, and record collections against each invoice.'
              : 'Log received customer payments, reconcile ledgers, and review official receipt vouchers.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view === 'bills' && canExportInvoices && (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
              onClick={() => void handleExportGstExcel()}
              disabled={exportingExcel}
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
              {exportingExcel ? 'Exporting...' : 'Export Excel'}
            </button>
          )}
          {view === 'bills' && canManageInvoices && (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-2xl bg-graphite px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-black"
              onClick={openCreateBillDrawer}
            >
              <Plus className="h-4 w-4" />
              Create Sales Invoice
            </button>
          )}
        </div>
      </div>

      {view === 'bills' && (
        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm">
            <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {/* 1. Total Billed */}
              <div className="flex flex-col justify-between rounded-xl border border-slate-200/90 bg-slate-50/70 p-3">
                <div className="flex items-center justify-between text-slate-500">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Billed</span>
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-slate-600 shadow-xs">
                    <FileText className="h-3.5 w-3.5" />
                  </div>
                </div>
                <div className="mt-1.5">
                  <p className="font-display text-lg font-black text-graphite tracking-tight">{formatCurrency(billSummary.totalBilled)}</p>
                  <p className="text-[11px] font-medium text-slate-500">
                    {billSummary.count} invoice{billSummary.count === 1 ? '' : 's'}
                  </p>
                </div>
              </div>

              {/* 2. Taxable Value */}
              <div className="flex flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-3">
                <div className="flex items-center justify-between text-slate-500">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Taxable Value</span>
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                    <Layers className="h-3.5 w-3.5" />
                  </div>
                </div>
                <div className="mt-1.5">
                  <p className="font-display text-lg font-black text-slate-900 tracking-tight">{formatCurrency(billSummary.taxable)}</p>
                  <p className="text-[11px] font-medium text-slate-500">Base amount</p>
                </div>
              </div>

              {/* 3. Total GST */}
              <div className="flex flex-col justify-between rounded-xl border border-indigo-200/90 bg-indigo-50/60 p-3">
                <div className="flex items-center justify-between text-indigo-700">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">Total GST</span>
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                    <Percent className="h-3.5 w-3.5" />
                  </div>
                </div>
                <div className="mt-1.5">
                  <p className="font-display text-lg font-black text-indigo-950 tracking-tight">{formatCurrency(billSummary.gst)}</p>
                  <p className="text-[11px] font-medium text-indigo-700/80">CGST + SGST</p>
                </div>
              </div>

              {/* 4. GST Split */}
              <div className="flex flex-col justify-between rounded-xl border border-violet-200/90 bg-violet-50/50 p-3">
                <div className="flex items-center justify-between text-violet-700">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-violet-700">GST Split</span>
                  <span className="rounded bg-violet-100/90 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">50/50</span>
                </div>
                <div className="mt-1.5 space-y-0.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-violet-600">CGST:</span>
                    <span className="font-bold text-violet-950">{formatCurrency(billSummary.cgst)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-violet-600">SGST:</span>
                    <span className="font-bold text-violet-950">{formatCurrency(billSummary.sgst)}</span>
                  </div>
                </div>
              </div>

              {/* 5. Collected */}
              <div className="flex flex-col justify-between rounded-xl border border-emerald-200/90 bg-emerald-50/50 p-3">
                <div className="flex items-center justify-between text-emerald-700">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Collected</span>
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                    <Receipt className="h-3.5 w-3.5" />
                  </div>
                </div>
                <div className="mt-1.5">
                  <p className="font-display text-lg font-black text-emerald-950 tracking-tight">{formatCurrency(billSummary.totalPaid)}</p>
                  <p className="text-[11px] font-medium text-emerald-700/80">Received payments</p>
                </div>
              </div>

              {/* 6. Outstanding */}
              <div className="flex flex-col justify-between rounded-xl border border-rose-200/90 bg-rose-50/50 p-3">
                <div className="flex items-center justify-between text-rose-700">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700">Outstanding</span>
                  {billSummary.overdueCount > 0 ? (
                    <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-black text-rose-800">
                      {billSummary.overdueCount} due
                    </span>
                  ) : null}
                </div>
                <div className="mt-1.5">
                  <p className="font-display text-lg font-black text-rose-950 tracking-tight">{formatCurrency(billSummary.totalBalance)}</p>
                  <p className="text-[11px] font-medium text-rose-700/80">
                    {billSummary.overdueCount > 0 ? `${billSummary.overdueCount} overdue` : 'Balance due'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <SectionCard
            title="GST Invoice Register"
            action={
              canExportInvoices ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-60"
                onClick={() => void handleExportGstExcel()}
                disabled={exportingExcel}
              >
                <FileSpreadsheet className="h-4 w-4" />
                {exportingExcel ? 'Exporting...' : 'Export as Excel'}
              </button>
              ) : null
            }
          >
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search bill no, client, project..."
                  className="w-full rounded-xl border border-slate-300 pl-9 pr-3 py-2 text-sm outline-none focus:border-graphite"
                  value={clientFilter}
                  onChange={(e) => setClientFilter(e.target.value)}
                />
              </div>
              <SearchableSelect
                options={[
                  { id: 'all', name: 'All Projects' },
                  ...availableProjectOptions.map((p) => ({ id: String(p.id), name: p.project_name })),
                ]}
                value={projectFilter}
                onChange={setProjectFilter}
                placeholder="Filter Project"
                widthClass="w-full"
              />
              <SearchableSelect
                options={[
                  { id: 'all', name: 'All Statuses' },
                  { id: 'unpaid', name: 'Unpaid' },
                  { id: 'partial', name: 'Partially Paid' },
                  { id: 'paid', name: 'Fully Paid' },
                ]}
                value={billStatusFilter}
                onChange={setBillStatusFilter}
                placeholder="Filter Status"
                widthClass="w-full"
              />
            </div>

            {filteredBills.length ? (
              <DataTable
                size="compact"
                ariaLabel="GST invoice register"
                auditTableName="bills"
                auditRecordIds={filteredBills.map((bill) => bill.id)}
                auditRecordLabel="GST invoice"
                printTitle="GST Invoice Register"
                printMetadata={{
                  Invoices: billSummary.count,
                  'Total of bills': formatCurrency(billSummary.totalBilled),
                  'Taxable value': formatCurrency(billSummary.taxable),
                  'Total GST': formatCurrency(billSummary.gst),
                }}
                printSummarySections={[
                  {
                    title: 'GST totals',
                    items: [
                      { label: 'Taxable value', value: formatCurrency(billSummary.taxable) },
                      { label: 'CGST', value: formatCurrency(billSummary.cgst) },
                      { label: 'SGST', value: formatCurrency(billSummary.sgst) },
                      { label: 'Total GST', value: formatCurrency(billSummary.gst) },
                      { label: 'Total of bills', value: formatCurrency(billSummary.totalBilled) },
                    ],
                  },
                ]}
                printOmitColumns={[10]}
                headers={['S.No', 'Bill No', 'Date', 'Project', 'Client', 'Taxable', 'GST % Split', 'GST Amount', 'Bill Total', 'Status', 'Actions']}
                footerRows={[
                  [
                    '',
                    <span key="gst-foot-label" className="font-black text-graphite">Totals</span>,
                    '',
                    '',
                    `${billSummary.count} invoice${billSummary.count === 1 ? '' : 's'}`,
                    <span key="gst-foot-taxable" className="font-black text-slate-900">{formatCurrency(billSummary.taxable)}</span>,
                    <span key="gst-foot-rate" className="text-xs font-bold text-slate-500">Split (50/50)</span>,
                    <span key="gst-foot-gst" className="font-black text-indigo-900">{formatCurrency(billSummary.gst)}</span>,
                    <span key="gst-foot-total" className="font-black text-graphite">{formatCurrency(billSummary.totalBilled)}</span>,
                    '',
                    '',
                  ],
                ]}
                rows={filteredBills.map((b, index) => {
                  const split = getBillGstSplit(b);
                  const rateInfo = getBillGstRateInfo(b);
                  return [
                    <span key={`sno-${b.id}`} className="font-black text-slate-500">{index + 1}</span>,
                    <button
                      type="button"
                      onClick={() => setPreviewBill(b)}
                      className="font-extrabold text-indigo-600 hover:text-indigo-800 hover:underline text-left cursor-pointer transition"
                      title="Click to preview invoice"
                    >
                      {b.bill_number}
                    </button>,
                    <span key={`date-${b.id}`} className="text-xs font-medium text-slate-600 whitespace-nowrap">{formatDate(b.bill_date)}</span>,
                    <span key={`proj-${b.id}`} className="font-semibold text-slate-800">
                      {b.is_custom_project ? (
                        <span className="inline-flex items-center gap-1">
                          {b.custom_project_name}
                          <span className="rounded bg-indigo-50 px-1 py-0.5 text-[9px] font-bold text-indigo-700">Custom</span>
                        </span>
                      ) : (
                        b.project_name || '-'
                      )}
                    </span>,
                    <div key={`client-${b.id}`}>
                      <p className="font-bold text-slate-900">
                        {b.is_custom_client ? b.custom_client_name : b.client_name}
                        {b.is_custom_client && (
                          <span className="ml-1.5 rounded bg-indigo-50 px-1 py-0.5 text-[9px] font-bold text-indigo-700">Custom</span>
                        )}
                      </p>
                      {b.company_name && <p className="text-[11px] text-slate-500">PAN: {b.company_name}</p>}
                    </div>,
                    <span key={`taxable-${b.id}`} className="font-semibold text-slate-700">{formatCurrency(b.subtotal)}</span>,
                    <div key={`rate-${b.id}`} className="flex flex-col text-xs leading-tight whitespace-nowrap">
                      <span className="font-extrabold text-indigo-900">{rateInfo.totalRate}% GST</span>
                      <span className="text-[9.5px] text-slate-500 font-semibold whitespace-nowrap">
                        {rateInfo.cgstRate}% CGST + {rateInfo.sgstRate}% SGST
                      </span>
                    </div>,
                    <span key={`gst-${b.id}`} className="font-extrabold text-indigo-900 whitespace-nowrap">
                      {formatCurrency(split.gst)}
                    </span>,
                    <span key={`tot-${b.id}`} className="font-extrabold text-graphite">{formatCurrency(b.total_amount)}</span>,
                    <div key={`stat-${b.id}`} className="flex flex-col items-start gap-1">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider ${
                          b.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : b.status === 'partial' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {b.status}
                      </span>
                      {b.gst_only ? (
                        <span className="inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-violet-800">
                          GST only
                        </span>
                      ) : null}
                    </div>,
                    <div key={`act-${b.id}`} className="flex items-center justify-center">
                      <button
                        type="button"
                        className={`flex h-8 w-8 items-center justify-center rounded-lg border text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 ${
                          billRowMenu?.billId === b.id ? 'border-slate-400 bg-slate-100 text-slate-800' : 'border-slate-200 bg-white'
                        }`}
                        onClick={(e) => toggleBillRowMenu(e, b.id)}
                        aria-label={`Actions for ${b.bill_number}`}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </div>,
                  ];
                })}
              />
            ) : (
              <div className="p-8 text-center text-slate-400 font-semibold">No bills or invoices match the current filters.</div>
            )}
            {billRowMenu ? createPortal((() => {
              const b = filteredBills.find((item) => item.id === billRowMenu.billId);
              if (!b) return null;
              return (
                <div
                  ref={billRowMenuRef}
                  className="fixed z-[200] w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
                  style={{ top: billRowMenu.top, left: billRowMenu.left }}
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                    onClick={() => {
                      setBillRowMenu(null);
                      setPreviewBill(b);
                    }}
                  >
                    <Eye className="h-4 w-4 text-indigo-600" />
                    Preview Invoice
                  </button>
                  {canPaymentEntry && b.balance_amount > 0 && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-bold text-emerald-700 hover:bg-emerald-50 transition"
                      onClick={() => {
                        setBillRowMenu(null);
                        openRecordPaymentModal(b);
                      }}
                    >
                      <Receipt className="h-4 w-4 text-emerald-600" />
                      Record Receipt (F6)
                    </button>
                  )}
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                    onClick={() => {
                      setBillRowMenu(null);
                      void exportBillPDF('download', b);
                    }}
                  >
                    <Download className="h-4 w-4 text-slate-500" />
                    Download PDF
                  </button>
                  {canManageInvoices && (
                    <>
                      <div className="my-1 border-t border-slate-100" />
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                        onClick={() => {
                          setBillRowMenu(null);
                          openEditBillDrawer(b);
                        }}
                      >
                        <FileText className="h-4 w-4 text-slate-500" />
                        Edit Invoice
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-bold text-rose-600 hover:bg-rose-50 transition"
                        onClick={() => {
                          setBillRowMenu(null);
                          if (confirm(`Delete bill ${b.bill_number}?`)) {
                            deleteBillMutation.mutate(b.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-rose-500" />
                        Delete Invoice
                      </button>
                    </>
                  )}
                </div>
              );
            })(), document.body) : null}
          </SectionCard>
        </div>
      )}

      {/* TAB 2: PAYMENT RECEIPTS & LOG */}
      {view === 'payments' && (
        <div className="space-y-5">
          {/* Print Section for Report */}
          <div className="payments-print-only hidden">
            <div className="p-8 font-sans text-slate-900">
              <div className="mb-5 flex items-start gap-4 border-b-[3px] border-slate-800 pb-4">
                <img src={kkrLogo} alt="KKR Logo" className="h-20 w-36 object-contain" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Billing ERP · Accounts & Billing</p>
                  <h1 className="mt-1 text-2xl font-black text-slate-950">Customer Receipt Vouchers Register</h1>
                  <p className="mt-2 text-sm font-semibold text-slate-600">
                    {paymentSummary.monthLabel} | {filteredPayments.length} entries | Total {formatCurrency(paymentSummary.totalAmount)}
                  </p>
                </div>
              </div>
              <table className="w-full border-collapse text-left text-[10.5px]">
                <thead>
                  <tr className="bg-slate-800 text-white font-bold">
                    {['Date', 'Project', 'Client Name', 'PAN No', 'Mode', 'Notes', 'Amount'].map((header) => (
                      <th key={header} className="border border-slate-300 px-2 py-2">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.map((p) => (
                    <tr key={`print-${p.id}`} className="even:bg-slate-50">
                      <td className="border border-slate-300 px-2 py-2">{formatDate(p.payment_date)}</td>
                      <td className="border border-slate-300 px-2 py-2 font-semibold">{p.project_name}</td>
                      <td className="border border-slate-300 px-2 py-2 font-semibold">{p.shareholder_name || p.client_name}</td>
                      <td className="border border-slate-300 px-2 py-2">{p.pan_no || p.company_name || '-'}</td>
                      <td className="border border-slate-300 px-2 py-2 uppercase">{p.payment_mode || 'Cash'}</td>
                      <td className="border border-slate-300 px-2 py-2">{p.notes || '-'}</td>
                      <td className="border border-slate-300 px-2 py-2 text-right font-bold">{formatCurrency(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
              <span className="text-xs font-bold uppercase tracking-wider text-blue-700">Total Payments</span>
              <p className="mt-1 text-2xl font-black text-blue-950">{filteredPayments.length}</p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Total Collection</span>
              <p className="mt-1 text-2xl font-black text-emerald-950">{formatCurrency(paymentSummary.totalAmount)}</p>
            </div>
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-700">Cost Centers / Jobs</span>
              <p className="mt-1 text-2xl font-black text-indigo-950">{paymentSummary.projectCount}</p>
            </div>
            <div className="rounded-2xl border border-purple-100 bg-purple-50/50 p-4">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-700">Active Clients</span>
              <p className="mt-1 text-2xl font-black text-purple-950">{paymentSummary.clientCount}</p>
            </div>
          </div>

          <SectionCard title="Payment Log & Receipt Register">
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search client, project, mode..."
                  className="w-full rounded-xl border border-slate-300 pl-9 pr-3 py-2 text-sm outline-none focus:border-graphite"
                  value={clientFilter}
                  onChange={(e) => setClientFilter(e.target.value)}
                />
              </div>
              <SearchableSelect
                options={[
                  { id: 'all', name: 'All Projects' },
                  ...availableProjectOptions.map((p) => ({ id: String(p.id), name: p.project_name })),
                ]}
                value={projectFilter}
                onChange={setProjectFilter}
                placeholder="Filter Project"
                widthClass="w-full"
              />
              <SearchableSelect
                options={[
                  { id: 'all', name: 'All Months' },
                  ...availableMonthOptions.map((m) => ({ id: m, name: m })),
                ]}
                value={monthFilter}
                onChange={setMonthFilter}
                placeholder="Filter Month"
                widthClass="w-full"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  onClick={() => window.print()}
                >
                  <Printer className="h-4 w-4" />
                  Print Report
                </button>
              </div>
            </div>

            {filteredPayments.length ? (
              <DataTable
                headers={canPaymentEntry ? ['Date', 'Project', 'Client Name', 'PAN No', 'Amount', 'Mode', 'Notes', 'Actions'] : ['Date', 'Project', 'Client Name', 'PAN No', 'Amount', 'Mode', 'Notes']}
                rows={filteredPayments.map((p) => [
                  <span key={`date-${p.id}`} className="text-xs font-semibold text-slate-700">{formatDate(p.payment_date)}</span>,
                  <span key={`proj-${p.id}`} className="font-bold text-slate-900">{p.project_name}</span>,
                  <span key={`client-${p.id}`} className="font-extrabold text-graphite">{p.shareholder_name || p.client_name}</span>,
                  <span key={`pan-${p.id}`} className="text-xs text-slate-600">{p.pan_no || p.company_name || '-'}</span>,
                  <span key={`amt-${p.id}`} className="font-extrabold text-emerald-800">{formatCurrency(p.amount)}</span>,
                  <span key={`mode-${p.id}`} className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold uppercase text-slate-700">{p.payment_mode || 'Cash'}</span>,
                  <span key={`notes-${p.id}`} className="text-xs text-slate-600 max-w-[200px] truncate inline-block">{p.notes || '-'}</span>,
                  canPaymentEntry ? (
                    <button
                      key={`del-${p.id}`}
                      type="button"
                      className="p-1 rounded-lg text-rose-600 hover:bg-rose-50"
                      onClick={() => {
                        if (confirm(`Delete payment entry for ${p.shareholder_name}?`)) {
                          deletePaymentMutation.mutate(p.id);
                        }
                      }}
                      title="Delete payment"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null,
                ])}
              />
            ) : (
              <div className="p-8 text-center text-slate-400 font-semibold">No payment entries match the filters.</div>
            )}
          </SectionCard>
        </div>
      )}

      {/* CREATE / EDIT BILL DRAWER */}
      {billDrawerOpen && (
        <div className="fixed inset-0 z-[100] flex justify-end bg-slate-950/45 backdrop-blur-xs transition-opacity animate-in fade-in">
          <div className="relative z-10 flex h-full max-h-full w-full min-w-0 flex-col max-w-xl sm:max-w-2xl lg:max-w-3xl bg-white shadow-2xl overflow-hidden border-l border-slate-200">
            <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-100 bg-white/95 px-6 py-4 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-amber-600" />
                <div>
                  <h2 className="text-lg font-black text-graphite">
                    {editingBillId ? 'Edit Sales Invoice' : 'Create Sales Invoice'}
                  </h2>
                  <p className="text-xs font-medium text-slate-500">
                    Generate an official tax invoice with line items, HSN/SAC codes, and auto-populated customer billing ledger.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                onClick={() => setBillDrawerOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={submitBillForm} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Project & Client Selection */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">Project & Client Details</h3>
                  <span className="text-[11px] font-semibold text-slate-500">Existing or custom entry</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {/* Project Field */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <RequiredLabel
                        label="Project"
                        required
                        filled={billForm.is_custom_project ? Boolean(billForm.custom_project_name.trim()) : billForm.project_id > 0}
                      />
                      <button
                        type="button"
                        className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition underline underline-offset-2"
                        onClick={() => {
                          setBillForm((prev) => ({
                            ...prev,
                            is_custom_project: !prev.is_custom_project,
                            project_id: prev.is_custom_project ? 0 : 0,
                            custom_project_name: '',
                            is_custom_client: !prev.is_custom_project ? true : prev.is_custom_client,
                            shareholder_id: 0,
                          }));
                        }}
                      >
                        {billForm.is_custom_project ? '← Select Existing' : '+ Custom Project'}
                      </button>
                    </div>

                    {billForm.is_custom_project ? (
                      <input
                        type="text"
                        className="w-full rounded-xl border border-indigo-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 font-medium placeholder:text-slate-400 shadow-sm"
                        placeholder="Type custom project name..."
                        value={billForm.custom_project_name}
                        onChange={(e) => setBillForm((prev) => ({ ...prev, custom_project_name: e.target.value }))}
                        autoFocus
                        required
                      />
                    ) : (
                      <SearchableSelect
                        options={availableProjectOptions.map((p) => ({ id: String(p.id), name: p.project_name }))}
                        value={billForm.project_id ? String(billForm.project_id) : ''}
                        onChange={(val) => handleProjectChangeForBill(Number(val))}
                        placeholder="Choose existing project..."
                        widthClass="w-full"
                      />
                    )}
                  </div>

                  {/* Client Field */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <RequiredLabel
                        label="Client Name"
                        required
                        filled={Boolean(billForm.client_name.trim())}
                      />
                      {!billForm.is_custom_project && billForm.project_id > 0 && (
                        <button
                          type="button"
                          className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition underline underline-offset-2"
                          onClick={() => {
                            setBillForm((prev) => ({
                              ...prev,
                              is_custom_client: !prev.is_custom_client,
                              shareholder_id: 0,
                              client_name: '',
                              company_name: '',
                              billing_address: '',
                              billing_city: '',
                              billing_pincode: '',
                            }));
                          }}
                        >
                          {billForm.is_custom_client ? '← Select from Project' : '+ Custom Client'}
                        </button>
                      )}
                    </div>

                    {!billForm.is_custom_project && !billForm.is_custom_client && billForm.project_id > 0 ? (
                      <SearchableSelect
                        options={projectShareholders.map((sh) => ({ id: String(sh.id), name: sh.name }))}
                        value={billForm.shareholder_id ? String(billForm.shareholder_id) : ''}
                        onChange={(val) => handleClientSelectForBill(Number(val))}
                        placeholder="Choose client from project..."
                        widthClass="w-full"
                      />
                    ) : (
                      <input
                        type="text"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-graphite font-medium placeholder:text-slate-400 shadow-sm"
                        placeholder="Type client name..."
                        value={billForm.client_name}
                        onChange={(e) => setBillForm((prev) => ({ ...prev, client_name: e.target.value }))}
                        required
                      />
                    )}
                  </div>
                </div>

                {/* If existing client selected, show editable Client Name field if needed */}
                {!billForm.is_custom_client && billForm.shareholder_id > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-white p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-semibold text-slate-500">Client Name on Bill: </span>
                      <span className="font-bold text-slate-900">{billForm.client_name || '-'}</span>
                    </div>
                    <input
                      type="text"
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-indigo-400 min-w-[180px]"
                      placeholder="Edit displayed name..."
                      value={billForm.client_name}
                      onChange={(e) => setBillForm((prev) => ({ ...prev, client_name: e.target.value }))}
                      title="Edit client name displayed on invoice"
                    />
                  </div>
                )}

                {/* Auto-populated & Editable Billing Address */}
                <div className="grid gap-3 sm:grid-cols-3 pt-2 border-t border-slate-200">
                  <div className="sm:col-span-3">
                    <RequiredLabel label="Billing Street Address" required filled={Boolean(billForm.billing_address.trim())} />
                    <input
                      type="text"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-graphite"
                      placeholder="Billing street address"
                      value={billForm.billing_address}
                      onChange={(e) => setBillForm((prev) => ({ ...prev, billing_address: e.target.value }))}
                      required
                    />
                  </div>
                  <div>
                    <RequiredLabel label="Billing District / City" required filled={Boolean(billForm.billing_city.trim())} />
                    <input
                      type="text"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-graphite"
                      placeholder="Billing city"
                      value={billForm.billing_city}
                      onChange={(e) => setBillForm((prev) => ({ ...prev, billing_city: e.target.value }))}
                      required
                    />
                  </div>
                  <div>
                    <RequiredLabel label="Billing Pincode" required filled={Boolean(billForm.billing_pincode.trim())} />
                    <input
                      type="text"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-graphite"
                      placeholder="Pincode"
                      value={billForm.billing_pincode}
                      onChange={(e) => setBillForm((prev) => ({ ...prev, billing_pincode: e.target.value }))}
                      required
                    />
                  </div>
                  <div>
                    <RequiredLabel label="PAN / Company" filled={Boolean(billForm.company_name.trim())} />
                    <input
                      type="text"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-graphite"
                      placeholder="PAN No / Company (optional)"
                      value={billForm.company_name}
                      onChange={(e) => setBillForm((prev) => ({ ...prev, company_name: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              {/* Bill Metadata */}
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <RequiredLabel label="Invoice Number" filled={Boolean(billForm.bill_number.trim())} />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        maxLength={50}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono font-bold outline-none focus:border-graphite"
                        placeholder={nextBillNumber || 'INV-YYYY-0001'}
                        value={billForm.bill_number}
                        onChange={(e) => setBillForm((prev) => ({ ...prev, bill_number: e.target.value }))}
                      />
                      {!editingBillId && nextBillNumber && billForm.bill_number.trim() !== nextBillNumber ? (
                        <button
                          type="button"
                          className="shrink-0 rounded-xl border border-slate-300 px-2.5 py-2 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                          onClick={() => setBillForm((prev) => ({ ...prev, bill_number: nextBillNumber }))}
                          title="Restore the generated invoice number"
                        >
                          Generated
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[10px] font-medium text-slate-500">
                      {editingBillId
                        ? 'Keep the existing number, or enter a different unused invoice number.'
                        : 'Generated number is filled in. Change it if you want your own invoice number.'}
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <RequiredLabel label="Bill Date" required filled={Boolean(billForm.bill_date)} />
                  <input
                    type="date"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-graphite"
                    value={billForm.bill_date}
                    onChange={(e) => setBillForm((prev) => ({ ...prev, bill_date: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <RequiredLabel label="Payment Due Date" required filled={Boolean(billForm.due_date)} />
                  <input
                    type="date"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-graphite"
                    value={billForm.due_date}
                    onChange={(e) => setBillForm((prev) => ({ ...prev, due_date: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <RequiredLabel label="Select Template / Company Seal" required filled={Boolean(billForm.seal_type)} />
                  <select
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-graphite bg-white font-bold text-graphite"
                    value={billForm.seal_type}
                    onChange={(e) => setBillForm((prev) => ({ ...prev, seal_type: e.target.value }))}
                  >
                    <option value="developers">KKR DEVELOPERS (GSTIN: 33GMCPK8915E2Z2)</option>
                    <option value="foundations">KKR FOUNDATIONS (GSTIN: 33HLZPK2038D1ZX)</option>
                  </select>
                </div>
                </div>
              </div>

              {/* Itemized Table */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">Line Items & Demand Breakdown</h3>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-2.5 py-1 rounded-lg transition"
                    onClick={addBillItemRow}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Row
                  </button>
                </div>

                <div className="space-y-2">
                  {billForm.items.map((item, idx) => (
                    <div key={idx} className="bg-white p-3 rounded-xl border border-slate-200 space-y-2">
                      <div className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-12 sm:col-span-6">
                          <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Particulars / Stage</label>
                          <input
                            type="text"
                            placeholder="e.g. Flat T1 payment"
                            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-graphite font-medium"
                            value={item.description}
                            onChange={(e) => handleBillItemChange(idx, 'description', e.target.value)}
                          />
                        </div>
                        <div className="col-span-6 sm:col-span-3">
                          <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">HSN Code</label>
                          <input
                            type="text"
                            placeholder="995411"
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-graphite font-mono"
                            value={item.hsn_code || '995411'}
                            onChange={(e) => handleBillItemChange(idx, 'hsn_code', e.target.value)}
                          />
                        </div>
                        <div className="col-span-6 sm:col-span-3">
                          <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Base Amount (₹)</label>
                          <input
                            type="number"
                            step="1"
                            placeholder="Amount"
                            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-right font-extrabold text-graphite outline-none focus:border-graphite"
                            value={item.amount || ''}
                            onChange={(e) => handleBillItemChange(idx, 'amount', e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-12 gap-2 items-center pt-1 border-t border-slate-100 text-xs">
                        <div className="col-span-4 sm:col-span-3">
                          <label className="block text-[10px] font-semibold text-slate-500">CGST %</label>
                          <input
                            type="number"
                            step="0.1"
                            className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs text-right"
                            value={item.cgst_rate ?? 2.5}
                            onChange={(e) => handleBillItemChange(idx, 'cgst_rate', e.target.value)}
                          />
                        </div>
                        <div className="col-span-4 sm:col-span-3">
                          <label className="block text-[10px] font-semibold text-slate-500">SGST %</label>
                          <input
                            type="number"
                            step="0.1"
                            className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs text-right"
                            value={item.sgst_rate ?? 2.5}
                            onChange={(e) => handleBillItemChange(idx, 'sgst_rate', e.target.value)}
                          />
                        </div>
                        <div className="col-span-4 sm:col-span-5 text-right font-bold text-slate-700">
                          Total with Tax: ₹ {formatCurrency((item.amount || 0) + (item.cgst_amount || 0) + (item.sgst_amount || 0))}
                        </div>
                        {billForm.items.length > 1 && (
                          <button
                            type="button"
                            className="col-span-12 sm:col-span-1 p-1 text-center text-rose-500 hover:text-rose-700"
                            onClick={() => removeBillItemRow(idx)}
                          >
                            <X className="h-4 w-4 mx-auto" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Subtotal & Calculations */}
                <div className="pt-3 border-t border-slate-200 space-y-2 text-xs">
                  <div className="flex justify-between items-center text-slate-700 font-semibold">
                    <span>Taxable value</span>
                    <span className="font-extrabold text-sm text-graphite">{formatCurrency(calculatedSubtotal)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-700 font-semibold">
                    <span>CGST</span>
                    <span className="font-bold text-slate-900">{formatCurrency(calculatedCgstAmount)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-700 font-semibold">
                    <span>SGST</span>
                    <span className="font-bold text-slate-900">{formatCurrency(calculatedSgstAmount)}</span>
                  </div>
                  <div className="flex justify-between items-center rounded-lg bg-indigo-50 px-3 py-2 font-bold text-indigo-900">
                    <span>Total GST</span>
                    <span>{formatCurrency(calculatedCgstAmount + calculatedSgstAmount)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-[11px] font-bold text-slate-500">Discount Amount (₹)</label>
                      <input
                        type="number"
                        step="1"
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-right font-bold"
                        value={billForm.discount_amount || ''}
                        onChange={(e) => setBillForm((prev) => ({ ...prev, discount_amount: Number(e.target.value || 0) }))}
                      />
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-sm font-black text-amber-900 bg-amber-100/70 p-3 rounded-xl border border-amber-200">
                    <span>Bill total</span>
                    <span className="text-lg font-black">{formatCurrency(calculatedTotalAmount)}</span>
                  </div>
                  {canGstBilling ? (
                  <label className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50/80 px-3 py-2.5 text-sm font-semibold text-indigo-950">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={Boolean(billForm.gst_only)}
                      onChange={(e) => setBillForm((prev) => ({ ...prev, gst_only: e.target.checked }))}
                    />
                    <span>
                      Count this payment toward GST only
                      <span className="mt-0.5 block text-[11px] font-semibold text-indigo-700">
                        Invoice still shows taxable value, but paid taxable amount will not reduce construction to-pay. GST tax still reduces GST balance.
                      </span>
                    </span>
                  </label>
                  ) : null}
                </div>
              </div>

              {/* Notes & Signature */}
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Remarks / Terms & Conditions</label>
                  <textarea
                    rows={5}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs outline-none focus:border-graphite"
                    placeholder="e.g. Payment due within 15 days of invoice date."
                    value={billForm.notes}
                    onChange={(e) => setBillForm((prev) => ({ ...prev, notes: e.target.value }))}
                  />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                  <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-600">Authorised signature</p>
                  <ESignImageUpload
                    label="Upload signature"
                    initialValue={billForm.signature_image || null}
                    onChange={(dataUrl) => {
                      writeStoredGstSignature(dataUrl);
                      setBillForm((prev) => ({ ...prev, signature_image: dataUrl }));
                    }}
                    onClear={() => {
                      writeStoredGstSignature(null);
                      setBillForm((prev) => ({ ...prev, signature_image: '' }));
                    }}
                  />
                  <p className="mt-2 text-[10px] font-medium leading-relaxed text-slate-500">
                    PNG or JPG of the proprietor sign. It is placed over the company seal on the invoice.
                  </p>
                </div>
              </div>

              <div className="sticky bottom-0 bg-white border-t border-slate-200 pt-4 flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  onClick={() => setBillDrawerOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-graphite py-3 text-sm font-bold text-white shadow-sm hover:bg-black disabled:opacity-60"
                  disabled={saveBillMutation.isPending}
                >
                  {saveBillMutation.isPending ? 'Saving...' : editingBillId ? 'Update Invoice' : 'Save GST Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RECORD PAYMENT MODAL */}
      {recordPaymentBill && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-extrabold text-graphite">Record Receipt Voucher (F6)</h3>
                <p className="text-xs text-slate-500">Invoice: {recordPaymentBill.bill_number}</p>
              </div>
              <button type="button" className="p-1 text-slate-400 hover:text-slate-700" onClick={() => setRecordPaymentBill(null)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs space-y-1">
                <p className="font-bold text-amber-900">Customer (Debtor): {recordPaymentBill.client_name}</p>
                <p className="text-amber-800">Total Invoice: ₹ {formatCurrency(recordPaymentBill.total_amount)}</p>
                <p className="font-black text-rose-700">Balance Due: ₹ {formatCurrency(recordPaymentBill.balance_amount)}</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Payment Date</label>
                <input
                  type="date"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  value={recordPaymentForm.payment_date}
                  onChange={(e) => setRecordPaymentForm((prev) => ({ ...prev, payment_date: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Amount Paid (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-emerald-800"
                  value={recordPaymentForm.amount || ''}
                  onChange={(e) => setRecordPaymentForm((prev) => ({ ...prev, amount: Number(e.target.value || 0) }))}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Payment Mode</label>
                <select
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white"
                  value={recordPaymentForm.payment_mode}
                  onChange={(e) => setRecordPaymentForm((prev) => ({ ...prev, payment_mode: e.target.value }))}
                >
                  <option value="cash">Cash</option>
                  <option value="online">Online / UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="others">Others</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Notes</label>
                <input
                  type="text"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  value={recordPaymentForm.notes}
                  onChange={(e) => setRecordPaymentForm((prev) => ({ ...prev, notes: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                className="flex-1 rounded-xl border border-slate-300 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
                onClick={() => setRecordPaymentBill(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700"
                disabled={recordPaymentMutation.isPending || !recordPaymentForm.amount}
                onClick={() =>
                  recordPaymentMutation.mutate({
                    billId: recordPaymentBill.id,
                    payload: recordPaymentForm,
                  })
                }
              >
                {recordPaymentMutation.isPending ? 'Processing...' : 'Submit & Issue Receipt'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GST Invoice Preview Modal */}
      {previewBill && (
        <div className="fixed inset-0 z-[120] flex items-stretch justify-center bg-slate-900/70 p-0 sm:p-3">
          <div className="flex h-full min-h-0 w-full max-w-[1440px] flex-col overflow-hidden rounded-none bg-white shadow-2xl ring-1 ring-slate-900/10 sm:rounded-2xl">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="rounded-lg bg-indigo-600 p-2 text-white shadow-sm">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-extrabold text-slate-900 text-base">
                      GST Invoice Preview — {previewBill.bill_number}
                    </h3>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider ${
                        previewBill.status === 'paid'
                          ? 'bg-emerald-100 text-emerald-800'
                          : previewBill.status === 'partial'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {previewBill.status}
                    </span>
                  </div>
                  <p className="truncate text-xs font-medium text-slate-500">
                    {previewBill.is_custom_project ? previewBill.custom_project_name : previewBill.project_name || 'Project Invoice'} • {previewBill.is_custom_client ? previewBill.custom_client_name : previewBill.client_name}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canPaymentEntry && previewBill.balance_amount > 0 && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700"
                    onClick={() => {
                      const b = previewBill;
                      setPreviewBill(null);
                      openRecordPaymentModal(b);
                    }}
                  >
                    <Receipt className="h-3.5 w-3.5" />
                    Record Receipt (F6)
                  </button>
                )}

                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-100"
                  onClick={() => void exportBillPDF('download', previewBill)}
                  title="Download Invoice as PDF"
                >
                  <Download className="h-3.5 w-3.5 text-slate-600" />
                  Download PDF
                </button>

                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-100"
                  onClick={() => void exportBillPDF('print', previewBill)}
                  title="Print Invoice"
                >
                  <Printer className="h-3.5 w-3.5 text-slate-600" />
                  Print
                </button>

                {canManageInvoices && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-200"
                    onClick={() => {
                      const b = previewBill;
                      setPreviewBill(null);
                      openEditBillDrawer(b);
                    }}
                  >
                    Edit
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setPreviewBill(null)}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
                  aria-label="Close preview"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col bg-slate-200/80 lg:flex-row">
              <div className="min-h-0 min-w-0 flex-1 overflow-auto p-3 sm:p-5">
                <div className="flex w-max min-w-full justify-center pb-6">
                  <div className="rounded-lg bg-white shadow-xl ring-1 ring-slate-900/10">
                    <JVBillPDF bill={previewBill} />
                  </div>
                </div>
              </div>
              <div className="shrink-0 border-t border-slate-200 bg-white p-4 lg:w-72 lg:overflow-y-auto lg:border-l lg:border-t-0">
                {canManageInvoices ? (
                  <>
                <p className="text-[11px] font-black uppercase tracking-wider text-slate-600">Sign this invoice</p>
                <p className="mt-1 mb-3 text-xs font-medium text-slate-500">
                  Upload a signature image to place it over the company seal. It is saved with this GST invoice.
                </p>
                <ESignImageUpload
                  label="Upload signature"
                  initialValue={previewBill.signature_image || null}
                  onChange={(dataUrl) => {
                    saveSignatureMutation.mutate({ bill: previewBill, signatureImage: dataUrl });
                  }}
                  onClear={() => {
                    saveSignatureMutation.mutate({ bill: previewBill, signatureImage: null });
                  }}
                />
                  </>
                ) : (
                  <p className="text-xs font-medium text-slate-500">Invoice preview only. Creating or editing invoices is turned off for this role.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Offscreen Bill PDF Template for Export */}
      {viewingBill && (
        <div className="absolute -left-[99999px] top-0 bg-white">
          <JVBillPDF ref={billPrintRef} bill={viewingBill} />
        </div>
      )}
    </div>
  );
}
