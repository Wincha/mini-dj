import { createRoot } from "react-dom/client";
import "./index.css";
import MiniDJPlayer from "./MiniDJPlayer";
import { I18nProvider } from "./i18n";

createRoot(document.getElementById("root")).render(
  <I18nProvider>
    <MiniDJPlayer />
  </I18nProvider>
);
