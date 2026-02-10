export function confirm(title: string, message: string): Promise<boolean> {
  return Promise.resolve(window.confirm(`${title}\n\n${message}`));
}

export function alert(title: string, message: string): void {
  window.alert(`${title}\n\n${message}`);
}
