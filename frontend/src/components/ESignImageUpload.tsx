import type { ChangeEvent } from 'react';

type ESignImageUploadProps = {
  onChange: (dataUrl: string) => void;
  onClear: () => void;
  initialValue?: string | null;
  label?: string;
};

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to read signature image.'));
    image.src = src;
  });
}

async function fileToSignatureDataUrl(file: File) {
  const raw = await readFileAsDataUrl(file);
  const image = await loadImage(raw);
  const maxWidth = 720;
  const maxHeight = 280;
  const ratio = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * ratio));
  canvas.height = Math.max(1, Math.round(image.height * ratio));
  const context = canvas.getContext('2d');
  if (!context) return raw;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export function ESignImageUpload({
  onChange,
  onClear,
  initialValue = null,
  label = 'Upload signature',
}: ESignImageUploadProps) {
  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const dataUrl = await fileToSignatureDataUrl(file);
    onChange(dataUrl);
  }

  return (
    <div className="flex w-full max-w-[240px] flex-col items-center gap-2">
      <div className="flex h-[96px] w-full items-center justify-center overflow-hidden rounded-xl border border-slate-300 bg-white p-2 shadow-sm">
        {initialValue ? (
          <img src={initialValue} alt="Uploaded signature" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="px-4 text-center text-xs font-semibold text-slate-400">Upload signature image</span>
        )}
      </div>
      <label className="w-full cursor-pointer rounded-xl bg-graphite px-3 py-2 text-center text-xs font-semibold text-white transition hover:bg-black">
        {label}
        <input type="file" accept="image/*" className="hidden" onChange={(event) => void handleFileChange(event)} />
      </label>
      {initialValue ? (
        <button
          type="button"
          className="rounded-md bg-slate-100 px-3 py-1 text-[10px] font-semibold text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
          onClick={onClear}
        >
          Remove signature
        </button>
      ) : null}
    </div>
  );
}
