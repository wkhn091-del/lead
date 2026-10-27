import { toast } from '../store/toasts';

/** Copies text and says so. Resolves to whether it worked. */
export async function copyText(text: string, labels: { copied: string; failed: string }) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older browsers and some embedded views: copy through a hidden field.
    const field = document.createElement('textarea');
    field.value = text;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    if (!copied) {
      toast.error(labels.failed, 'סמנו את הטקסט והעתיקו אותו ידנית.');
      return false;
    }
  }
  toast.success(labels.copied);
  return true;
}
