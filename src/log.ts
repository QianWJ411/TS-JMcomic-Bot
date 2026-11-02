const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

function color(code: string, text: string): string {
  return useColor ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
}

export const log = {
  info(message: string): void {
    console.log(`${color("90", stamp())} ${color("36", "INFO ")} ${message}`);
  },
  warn(message: string): void {
    console.warn(`${color("90", stamp())} ${color("33", "WARN ")} ${message}`);
  },
  error(message: string): void {
    console.error(`${color("90", stamp())} ${color("31", "ERROR")} ${message}`);
  },
  debug(message: string): void {
    if (process.env.TSBOT_DEBUG === "1") {
      console.log(`${color("90", stamp())} ${color("90", "DEBUG")} ${message}`);
    }
  },
};
