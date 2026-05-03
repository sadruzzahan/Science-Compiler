import { createRoot } from "react-dom/client";
import App from "./App";
import { initSentry, setLastRequestId } from "./lib/sentry";
import { setResponseObserver } from "@workspace/api-client-react";
import "./index.css";

initSentry();
setResponseObserver((response) => {
  const id = response.headers.get("X-Request-ID");
  if (id) setLastRequestId(id);
});

createRoot(document.getElementById("root")!).render(<App />);
