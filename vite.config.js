import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
export default defineConfig({
    base: "/functions/v1/static-site/",
    plugins: [react(), tailwindcss()],
});
