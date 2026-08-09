export function focusInvalidField(selector: string): void {
  window.requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>(selector);
    if (!target) return;

    const control =
      target.matches("input, textarea, select, [role='combobox']")
        ? target
        : target.querySelector<HTMLElement>(
            [
              ".mantine-Input-input:not([type='hidden'])",
              ".mantine-Checkbox-input",
              ".mantine-TagsInput-input",
              "textarea",
              "select",
              "input:not([type='hidden'])",
              "[role='combobox']",
              "[tabindex]:not([tabindex='-1'])",
            ].join(", ")
          ) ?? target;

    control.classList.remove("pt-invalid-field-pulse");
    void control.offsetWidth;
    control.classList.add("pt-invalid-field-pulse");
    window.setTimeout(() => control.classList.remove("pt-invalid-field-pulse"), 1300);
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    const focusable =
      control.matches("input, textarea, button, [tabindex]")
        ? control
        : control.querySelector<HTMLElement>("input, textarea, button, [tabindex]:not([tabindex='-1'])");
    window.setTimeout(() => focusable?.focus({ preventScroll: true }), 180);
  });
}
