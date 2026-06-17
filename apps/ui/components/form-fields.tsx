export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 dark:text-zinc-400 mb-1.5 font-medium">{label}</label>
      {children}
    </div>
  );
}

export function Input({ value, onChange, placeholder, type = 'text' }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-zinc-100 focus:outline-none focus:border-cyan-500 dark:focus:border-cyan-500 placeholder-gray-300 dark:placeholder-zinc-600"
    />
  );
}

export function FieldGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden divide-y divide-gray-100 dark:divide-zinc-800">
      {children}
    </div>
  );
}

export function GroupedField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] font-medium text-gray-400 dark:text-zinc-500 mb-1 uppercase tracking-wide">{label}</p>
      {children}
    </div>
  );
}

export function GroupedInput({ value, onChange, placeholder, type = 'text' }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-transparent text-sm text-gray-900 dark:text-zinc-100 focus:outline-none placeholder-gray-300 dark:placeholder-zinc-600"
    />
  );
}
