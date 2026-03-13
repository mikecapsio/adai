import { createApp } from "./app";
import { PORT } from "./config/env";

const app = createApp();
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend listening on port ${PORT}`);
});

function shutdown(signal: NodeJS.Signals) {
  console.log(`${signal} received, closing backend server.`);

  server.close((error) => {
    if (error) {
      console.error("Error while shutting down the backend server.", error);
      process.exit(1);
    }

    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
