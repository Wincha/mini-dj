import { createRoot } from "react-dom/client";
import "./index.css";
import MiniDJPlayer from "./MiniDJPlayer";
import { I18nProvider } from "./i18n";
import { installGlobalErrorHandlers } from "./lib/log";

// Lo que no capture nadie acaba también en el registro
installGlobalErrorHandlers();

createRoot(document.getElementById("root")).render(
  <I18nProvider>
    <MiniDJPlayer />
  </I18nProvider>
);
