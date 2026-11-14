// Offers text as a file for download. The browser puts it into its download folder
// (with the same name it usually appends a number).
export function downloadText(fileName, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
