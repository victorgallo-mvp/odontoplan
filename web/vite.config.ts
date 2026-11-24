import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Portas configuráveis para conviver com outros projetos locais:
//   WEB_PORT=5174 API_PORT=3002 npm run dev
const apiPort = process.env.API_PORT ?? process.env.PORT ?? "3001";
const webPort = Number(process.env.WEB_PORT ?? 5173);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": `http://localhost:${apiPort}`,
    },
  },
});
