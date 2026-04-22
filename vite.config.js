var _a;
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
export default defineConfig({
    base: (_a = process.env.VITE_BASE_PATH) !== null && _a !== void 0 ? _a : "/",
    plugins: [react(), tailwindcss()],
});
