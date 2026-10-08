import { useState, useMemo, useEffect, useRef } from 'react';
import { ChevronDown, Plus, Check } from 'lucide-react';
import clsx from 'clsx';

export interface SelectOption {
  id: string | number;
  name: string;
  subtext?: string;
}

interface SearchableCreatableSelectProps {
  options: SelectOption[];
  value: string | number;
  onChange: (value: any, option?: SelectOption | null) => void;
  placeholder?: string;
  className?: string;
  inputId?: string;
  disabled?: boolean;
  allowCreate?: boolean;
  createLabelPrefix?: string;
  inputClassName?: string;
}

export function SearchableCreatableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select or type to search...',
  className,
  inputId,
  disabled = false,
  allowCreate = true,
  createLabelPrefix = 'Use',
  inputClassName,
}: SearchableCreatableSelectProps) {
  const [searchText, setSearchText] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const selectedOption = useMemo(() => {
    return options.find(
      (opt) => String(opt.id) === String(value) || opt.name.toLowerCase() === String(value).toLowerCase()
    );
  }, [options, value]);

  const filteredOptions = useMemo(() => {
    const query = searchText.toLowerCase().trim();
    if (!query) return options;
    return options.filter(
      (opt) =>
        opt.name.toLowerCase().includes(query) || (opt.subtext && opt.subtext.toLowerCase().includes(query))
    );
  }, [options, searchText]);

  const exactMatch = useMemo(() => {
    const query = searchText.toLowerCase().trim();
    if (!query) return true;
    return options.some((opt) => opt.name.toLowerCase() === query);
  }, [options, searchText]);

  // Display text in input box
  const displayValue = isFocused ? searchText : (selectedOption ? selectedOption.name : String(value || ''));

  const handleSelectOption = (opt: SelectOption) => {
    onChange(opt.id, opt);
    setSearchText('');
    setIsOpen(false);
    setIsFocused(false);
  };

  const handleCreateCustom = (customText: string) => {
    const trimmed = customText.trim();
    if (!trimmed) return;
    onChange(trimmed, null);
    setSearchText('');
    setIsOpen(false);
    setIsFocused(false);
  };

  return (
    <div ref={containerRef} className={clsx('relative w-full text-left', className)}>
      <div className="relative flex items-center">
        <input
          id={inputId}
          type="text"
          disabled={disabled}
          className={clsx(
            'w-full !rounded-xl !px-3 !py-2 !pr-8 !text-sm border border-slate-300 bg-white text-graphite outline-none focus:border-slate-400 shadow-sm transition',
            disabled && 'opacity-50 cursor-not-allowed bg-slate-50',
            inputClassName
          )}
          placeholder={placeholder}
          value={displayValue}
          onFocus={() => {
            if (disabled) return;
            setIsFocused(true);
            setSearchText(selectedOption ? selectedOption.name : String(value || ''));
            setIsOpen(true);
          }}
          onChange={(e) => {
            const val = e.target.value;
            setSearchText(val);
            setIsOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (filteredOptions.length > 0 && !searchText.trim()) {
                handleSelectOption(filteredOptions[0]);
              } else if (searchText.trim()) {
                const match = options.find((o) => o.name.toLowerCase() === searchText.trim().toLowerCase());
                if (match) {
                  handleSelectOption(match);
                } else if (allowCreate) {
                  handleCreateCustom(searchText);
                }
              }
            } else if (e.key === 'Escape') {
              setIsOpen(false);
              setIsFocused(false);
            }
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          className="absolute right-2 flex items-center justify-center p-1 text-slate-400 hover:text-slate-600 transition"
          onClick={() => {
            if (disabled) return;
            setIsOpen((prev) => !prev);
            if (!isOpen) {
              setIsFocused(true);
              setSearchText('');
            }
          }}
        >
          <ChevronDown className={clsx('h-4 w-4 transition-transform duration-200', isOpen && 'rotate-180')} />
        </button>
      </div>

      {isOpen && !disabled && (
        <div className="absolute left-0 right-0 mt-1.5 z-[250] max-h-60 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl space-y-0.5">
          {/* Custom Create Option if typing non-matching text */}
          {allowCreate && searchText.trim() && !exactMatch && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-xs font-bold rounded-xl transition-colors bg-emerald-50 text-emerald-800 hover:bg-emerald-100 flex items-center justify-between gap-2 border border-emerald-200 mb-1"
              onMouseDown={(e) => {
                e.preventDefault();
                handleCreateCustom(searchText);
              }}
            >
              <span className="truncate">
                {createLabelPrefix} "{searchText.trim()}"
              </span>
              <span className="shrink-0 flex items-center gap-1 text-[10px] bg-emerald-600 text-white px-2 py-0.5 rounded-full font-bold uppercase">
                <Plus className="h-3 w-3" /> New
              </span>
            </button>
          )}

          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt) => {
              const isSelected =
                String(opt.id) === String(value) || opt.name.toLowerCase() === String(value).toLowerCase();
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={clsx(
                    'w-full text-left px-3 py-2 text-xs font-medium rounded-xl transition-colors flex items-center justify-between gap-2',
                    isSelected
                      ? 'bg-graphite text-white font-semibold'
                      : 'text-slate-700 hover:bg-slate-100'
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectOption(opt);
                  }}
                >
                  <div className="flex flex-col truncate">
                    <span className="truncate font-semibold">{opt.name}</span>
                    {opt.subtext && (
                      <span className={clsx('text-[10px] truncate', isSelected ? 'text-slate-300' : 'text-slate-500')}>
                        {opt.subtext}
                      </span>
                    )}
                  </div>
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-white" />}
                </button>
              );
            })
          ) : !allowCreate || !searchText.trim() ? (
            <div className="px-3 py-3 text-xs text-slate-400 font-semibold text-center">
              No matching items found
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
