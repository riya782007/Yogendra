"use client";

import { snapColorName } from "@/lib/colors";

/** Colour field that snaps SILVAR / gren onto the catalog name on blur. The server snaps again on save. */
export function ColorNameInput({
  name = "color",
  defaultValue,
  list,
  placeholder,
  className,
}: {
  name?: string;
  defaultValue?: string;
  list?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      name={name}
      list={list}
      defaultValue={defaultValue}
      placeholder={placeholder}
      className={className}
      autoComplete="off"
      onBlur={(e) => {
        const snapped = snapColorName(e.target.value);
        if (snapped !== e.target.value) e.target.value = snapped;
      }}
    />
  );
}
