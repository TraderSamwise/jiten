import * as fs from "fs";
import * as path from "path";

export const CACHE_DIR = path.resolve(__dirname, "..", "..", ".cache");
export const ASSETS_DIR = path.resolve(__dirname, "..", "..", "assets");

export async function downloadFile(url: string, dest: string): Promise<void> {
  if (fs.existsSync(dest)) {
    console.log(`  Using cached: ${path.basename(dest)}`);
    return;
  }
  console.log(`  Downloading: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buffer);
}
