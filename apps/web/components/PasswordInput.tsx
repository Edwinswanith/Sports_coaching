"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Icon } from "./ui";

/**
 * A password <input> with a built-in show/hide (eye) toggle, like every app has.
 *
 * Forwards all standard input props. Layout/margin classes belong on
 * `wrapperClassName` (the toggle is absolutely positioned inside the wrapper);
 * `className` styles the input itself (defaults to the `.field` utility). We add
 * right padding so the entered text never sits under the eye button.
 */
export function PasswordInput({
  className = "field",
  wrapperClassName = "",
  disabled,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { wrapperClassName?: string }) {
  const [show, setShow] = useState(false);

  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        {...props}
        disabled={disabled}
        type={show ? "text" : "password"}
        className={`${className} pr-11`}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        disabled={disabled}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        // Keep it out of the tab order so Tab still goes straight to the next
        // field; the toggle is a pointer affordance, not a form step.
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-faint transition hover:text-ink disabled:opacity-40"
      >
        {show ? <Icon.eyeOff /> : <Icon.eye />}
      </button>
    </div>
  );
}
