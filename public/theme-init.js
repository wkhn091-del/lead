// Applies a saved light/dark choice before the page paints (see src/lib/theme.ts), and the Hebrew
// right-to-left direction for pages that embed the build without index.html's <html lang="he" dir="rtl">.
// It lives in a file rather than inline so the server's Content Security Policy allows it.
document.documentElement.lang = 'he';
document.documentElement.dir = 'rtl';
try {
  var theme = localStorage.getItem('omek-crm:theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
} catch (error) {}
