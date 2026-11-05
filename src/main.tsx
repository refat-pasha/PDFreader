import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { attachPersistence, loadPersistedState } from "./app/persistence";
import "./styles/tokens.css";
import "./styles/app.css";

loadPersistedState();
attachPersistence();

const root = document.getElementById("root");
if (!root) throw new Error("Application root element is missing.");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
