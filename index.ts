import { printChatGPTReport } from './providers/chatgpt.js';
import { printShapr3DPricesReport } from './providers/shapr3d.js';
import { printYtPricesReport } from './providers/youtube.js';

const commands: Record<string, () => Promise<void>> = {
  youtube: printYtPricesReport,
  yt: printYtPricesReport,
  shapr3d: printShapr3DPricesReport,
  shapr: printShapr3DPricesReport,
  chatgpt: printChatGPTReport,
  gpt: printChatGPTReport,
};

const arg = process.argv[2];
const command = commands[arg];

if (command) {
  command().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
} else {
  console.log('Usage: npx tsx index.ts <product>');
  console.log('Products:');
  console.log('  youtube, yt    - YouTube Premium prices');
  console.log('  shapr3d, shapr - Shapr3D prices');
  console.log('  chatgpt, gpt   - ChatGPT prices');
  process.exitCode = 1;
}
