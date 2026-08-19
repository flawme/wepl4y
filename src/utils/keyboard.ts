export function isEditableElement(element: Element | null): boolean {
  if (!element || !(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  const tagName = element.tagName;
  if (tagName === "TEXTAREA" || tagName === "SELECT") return true;
  if (tagName === "INPUT") {
    const type = (element as HTMLInputElement).type?.toLowerCase();
    const nonTextTypes = [
      "range",
      "checkbox",
      "radio",
      "button",
      "submit",
      "reset",
      "color",
      "file",
      "image",
    ];
    return !nonTextTypes.includes(type);
  }
  return false;
}
