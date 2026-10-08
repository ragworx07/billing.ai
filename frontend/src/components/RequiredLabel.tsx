export function RequiredLabel({
  label,
  required = false,
  filled = false,
}: {
  label: string;
  required?: boolean;
  filled?: boolean;
}) {
  if (!required) {
    return <label className="mb-2 block text-sm font-medium text-slate">{label}</label>;
  }

  return (
    <label className="mb-2 block text-sm font-medium text-slate">
      {label} <span className="font-bold text-red-600">*</span>{' '}
      <span className={`text-xs ${filled ? 'text-green-600' : 'text-slate/60'}`}>{filled ? 'filled' : 'required'}</span>
    </label>
  );
}
