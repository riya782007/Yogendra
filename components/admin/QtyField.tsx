"use client";
import { useState, useEffect } from "react";

/**
 * Quantity input you can actually clear and retype. Holds raw text while editing
 * (so backspacing the default "1" works), and clamps to `min` only on blur.
 */
export function QtyField({
  value, onChange, min = 1, name, className = "",
}: {
  value: number; onChange?: (n: number) => void; min?: number; name?: string; className?: string;
}) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => { setRaw(String(value)); }, [value]);

  return (
    <input
      type="number"
      inputMode="numeric"
      name={name}
      value={raw}
      min={min}
      onChange={(e) => {
        setRaw(e.target.value);
        const n = parseInt(e.target.value, 10);
        if (!Number.isNaN(n)) onChange?.(Math.max(min, n));
      }}
      onBlur={() => {
        const n = parseInt(raw, 10);
        const v = Number.isNaN(n) ? min : Math.max(min, n);
        setRaw(String(v));
        onChange?.(v);
      }}
      className={`[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${className}`}
    />
  );
}
