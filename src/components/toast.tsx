"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Check, Info, X, XCircle } from "lucide-react";

export type ToastTone = "info" | "success" | "warning" | "error";

export type ToastOptions = {
  title: string;
  description?: string;
  tone?: ToastTone;
  duration?: number;
};

type ToastItem = ToastOptions & {
  id: number;
  tone: ToastTone;
  state: "open" | "closed";
};

type ToastContextValue = {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const EXIT_MS = 180;
const DEFAULT_DURATION = 5000;

const TONE = {
  info: { icon: Info, color: "#9ca3af", border: "#262727" },
  success: { icon: Check, color: "#00e599", border: "#00e59955" },
  warning: { icon: AlertTriangle, color: "#f59e0b", border: "#f59e0b55" },
  error: { icon: XCircle, color: "#ef4444", border: "#ef444455" },
} as const;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      setItems((list) =>
        list.map((t) => (t.id === id ? { ...t, state: "closed" } : t)),
      );
      const exit = setTimeout(() => remove(id), EXIT_MS);
      timers.current.set(-id, exit);
    },
    [remove],
  );

  const toast = useCallback(
    ({ duration = DEFAULT_DURATION, tone = "info", ...rest }: ToastOptions) => {
      const id = nextId.current++;
      setItems((list) => [...list, { ...rest, tone, id, state: "open" }]);
      if (duration > 0) {
        timers.current.set(id, setTimeout(() => dismiss(id), duration));
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ol
        aria-label="Notifications"
        tabIndex={-1}
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {items.map((item) => (
          <ToastRow key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </ol>
    </ToastContext.Provider>
  );
}

function ToastRow({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const { icon: Icon, color, border } = TONE[item.tone];
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const visible = entered && item.state === "open";

  return (
    <li
      role={item.tone === "error" ? "alert" : "status"}
      aria-live={item.tone === "error" ? "assertive" : "polite"}
      data-state={item.state}
      style={{ borderColor: border }}
      className={`pointer-events-auto flex items-start gap-2.5 rounded-[4px] border bg-[#131414] p-3 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.9)] transition-[opacity,translate] duration-[180ms] ease-out ${
        visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      }`}
    >
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" style={{ color }} />

      <div className="min-w-0 flex-1">
        <p className="text-ui leading-[1.4] text-foreground">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-pretty text-caption leading-[1.5] text-[#9ca3af]">
            {item.description}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss notification"
        className="relative -m-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-[#9ca3af] transition-colors duration-150 ease-out before:absolute before:-inset-2 before:content-[''] hover:bg-[#1a1b1b] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e599]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0d0d]"
      >
        <X className="h-3 w-3" />
      </button>
    </li>
  );
}
