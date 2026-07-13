"use client";
/**
 * AutosaveForm — a normal <form> that ALSO saves automatically a moment after the owner leaves a field
 * (on blur, debounced). This fixes the "I edited a colour's polish/stock and it vanished after Save"
 * problem: variant edits live in their own per-row form, but owners naturally click the Basic tab's big
 * "Save changes" (which doesn't touch variants). With autosave the row persists no matter which button
 * they click. The explicit Save button still works, and any button with its own formAction (e.g. Delete)
 * is respected — autosave is skipped while a real submit is happening.
 */
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";

export function AutosaveForm({
  action, children, className, savedMsg = "Saved ✓",
}: {
  action: (fd: FormData) => Promise<void>;
  children: React.ReactNode;
  className?: string;
  savedMsg?: string;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitting = useRef(false);
  const router = useRouter();
  const { toast } = useToast();

  async function save() {
    const form = ref.current;
    if (!form || submitting.current) return;
    submitting.current = true;
    try {
      await action(new FormData(form));
      toast(savedMsg, "success");
      router.refresh();
    } catch {
      toast("Could not save — try again", "error");
    } finally {
      submitting.current = false;
    }
  }

  // Debounce so tabbing through several fields saves once, not on every field.
  function onBlur(e: React.FocusEvent<HTMLFormElement>) {
    // Ignore blur caused by clicking a button that has its OWN action (e.g. Delete) — let it run.
    const next = e.relatedTarget as HTMLElement | null;
    if (next && next.tagName === "BUTTON" && next.hasAttribute("formaction")) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 500);
  }

  return (
    <form ref={ref} className={className} onBlur={onBlur}
      onSubmit={(e) => { e.preventDefault(); if (timer.current) clearTimeout(timer.current); save(); }}>
      {children}
    </form>
  );
}
