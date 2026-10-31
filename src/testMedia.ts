import { executeLocalCommand } from "./commands/index.js";

const result = await executeLocalCommand("RESUME_MUSIC");
console.log(result);
