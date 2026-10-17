import { execSync } from "child_process";
import fs from "fs";
import path from "path";

async function main() {
  console.log("=== INSPEKSI 9ROUTER PROSES & CONFIG ===");

  // 1. Cek netstat PID
  try {
    const netstatOut = execSync('netstat -ano | findstr "20128"').toString();
    console.log("Netstat 20128:\n", netstatOut);

    const lines = netstatOut.trim().split("\n");
    const pids = new Set<string>();
    for (const l of lines) {
      const parts = l.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && !isNaN(Number(pid))) pids.add(pid);
    }

    for (const pid of pids) {
      try {
        const tasklist = execSync(`tasklist /FI "PID eq ${pid}" /FO LIST`).toString();
        console.log(`Process Details (PID ${pid}):\n`, tasklist);
      } catch (e: any) {
        console.log(`Could not get tasklist for PID ${pid}`);
      }
    }
  } catch (e: any) {
    console.log("Error running netstat:", e.message);
  }

  // 2. Cek lokasi file 9router di disk
  const possiblePaths = [
    path.join(process.env.USERPROFILE || "", ".9router"),
    path.join(process.env.USERPROFILE || "", "9router"),
    path.join(process.env.APPDATA || "", "9router"),
    path.join(process.env.LOCALAPPDATA || "", "9router"),
    path.join(process.env.USERPROFILE || "", ".config", "9router"),
    "C:\\9router",
  ];

  console.log("\nChecking possible 9Router directories on disk:");
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log(`FOUND: ${p}`);
      try {
        const files = fs.readdirSync(p);
        console.log(`  Files:`, files);
      } catch (err: any) {
        console.log(`  Cannot read directory:`, err.message);
      }
    }
  }
}

main().catch(console.error);
