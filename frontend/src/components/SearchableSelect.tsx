import { useState, useMemo, useEffect, useRef } from 'react';
import { Filter } from 'lucide-react';
import clsx from 'clsx';

interface Option {
  id: string | number;
  name: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string | number;
  onChange: (value: any) => void;
  placeholder?: string;
  className?: string;
  inputId?: string;
  disabled?: boolean;
  widthClass?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Search...',
  className,
  inputId,
  disabled = false,
  widthClass = 'w-48',
}: SearchableSelectProps) {
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
    return options.find((opt) => opt.id === value);
  }, [options, value]);

  const filteredOptions = useMemo(() => {
    const query = searchText.toLowerCase().trim();
    if (!query) return options;
    return options.filter((opt) => opt.name.toLowerCase().includes(query));
  }, [options, searchText]);

  const displayValue = isFocused ? searchText : (selectedOption?.name || '');

  return (
    <div ref={containerRef} className={clsx("relative inline-block text-left", widthClass, className)}>
      <input
        id={inputId}
        type="text"
        disabled={disabled}
        className={clsx(
          "h-9 w-full rounded-xl border border-line bg-white px-3 pr-8 text-xs font-semibold text-slate-700 shadow-sm outline-none transition focus:border-clay focus:ring-1 focus:ring-clay/30",
          disabled && "opacity-50 cursor-not-allowed bg-slate-50"
        )}
        placeholder={placeholder}
        value={displayValue}
        onFocus={() => {
          if (disabled) return;
          setIsFocused(true);
          setSearchText('');
          setIsOpen(true);
        }}
        onChange={(e) => {
          setSearchText(e.target.value);
          setIsOpen(true);
        }}
      />
      <span className="absolute inset-y-0 right-0 flex items-center pr-2.5 pointer-events-none text-slate-400">
        <Filter className="h-3.5 w-3.5" />
      </span>

      {isOpen && !disabled && (
        <div className="absolute right-0 mt-1 z-[150] w-64 max-h-60 overflow-y-auto rounded-2xl border border-line bg-white p-1.5 shadow-2xl">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={clsx(
                  "w-full text-left px-3 py-2 text-xs font-bold rounded-xl transition-colors",
                  value === opt.id
                    ? "bg-sand text-brand"
                    : "text-graphite hover:bg-mist"
                )}
                onMouseDown={() => {
                  onChange(opt.id);
                  setSearchText('');
                  setIsOpen(false);
                  setIsFocused(false);
                }}
              >
                {opt.name}
              </button>
            ))
          ) : (
            <div className="px-3 py-4 text-xs text-slate-400 font-bold text-center">
              No matches for "{searchText}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
