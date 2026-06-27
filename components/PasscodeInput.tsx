"use client";
/**
 * PasscodeInput — a password/passcode field with a show/hide toggle.
 * Used on the owner + staff sign-in. Lives inside a normal <form> and keeps its
 * `name`, so it posts to the server action exactly like a plain password input.
 */
import { useState } from "react";

export function PasscodeInput({
  name = "passcode",
  placeholder,
  autoFocus,
  className = "",
}: {
  name?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        name={name}
        type={show ? "text" : "password"}
        autoFocus={autoFocus}
        placeholder={placeholder}
        autoComplete="current-password"
        className={`${className} pr-16`}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-pressed={show}
        aria-label={show ? "Hide passcode" : "Show passcode"}
        title={show ? "Hide passcode" : "Show passcode"}
        className="absolute inset-y-0 right-2 my-auto h-7 px-2 rounded-md text-xs font-medium text-muted hover:text-ink hover:bg-cream transition-colors"
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}
