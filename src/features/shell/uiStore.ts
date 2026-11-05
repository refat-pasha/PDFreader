import { create } from "zustand";

export type ModalKind = "none" | "export" | "shortcuts" | "settings" | "open-note" | "organize";

type UiState = {
  modal: ModalKind;
  commandOpen: boolean;
  searchOpen: boolean;
  dropActive: boolean;
  openModal: (modal: Exclude<ModalKind, "none">) => void;
  closeModal: () => void;
  setCommandOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setDropActive: (active: boolean) => void;
};

export const useUi = create<UiState>((set) => ({
  modal: "none",
  commandOpen: false,
  searchOpen: false,
  dropActive: false,
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: "none" }),
  setCommandOpen: (open) => set({ commandOpen: open }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setDropActive: (active) => set({ dropActive: active }),
}));
