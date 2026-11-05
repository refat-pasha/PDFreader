export type Point = { x: number; y: number };

export type Tool =
  | "select"
  | "hand"
  | "pen"
  | "highlighter"
  | "rect"
  | "ellipse"
  | "arrow"
  | "text"
  | "note"
  | "eraser";

export type AnnotationKind = Exclude<Tool, "select" | "hand" | "eraser"> | "image" | "highlight";

export type Annotation = {
  id: string;
  docId: string;
  pageIndex: number;
  kind: AnnotationKind;
  color: string;
  opacity: number;
  strokeWidth: number;
  /** Points in PDF page coordinates, bottom-left origin. */
  points: Point[];
  text?: string;
  fontSize?: number;
  /** Data URL for image stamps. */
  imageData?: string;
  createdAt: number;
  updatedAt: number;
};

export type DocumentSource = "demo" | "local" | "browser";

export type DocumentMeta = {
  id: string;
  name: string;
  path?: string;
  pageCount: number;
  size: number;
  source: DocumentSource;
  openedAt: number;
};

export type ZoomMode = "custom" | "fit-width" | "fit-page";

export type PaneView = {
  page: number;
  scale: number;
  zoomMode: ZoomMode;
  rotation: number;
  scrollTop: number;
};

export type PaneDirection = "row" | "column";

export type Pane = {
  id: string;
  tabs: string[];
  activeDocId?: string;
  view: PaneView;
};

export type SidebarPanel = "thumbnails" | "outline" | "search" | "notes" | "bookmarks";

export type Bookmark = {
  id: string;
  docId: string;
  pageIndex: number;
  label: string;
  createdAt: number;
};

export type ExportFormat = "pdf" | "docx" | "doc" | "markdown" | "text" | "png";

export type AnnotationJson = {
  version: 1;
  document: { name: string; pageCount: number; fingerprint: string };
  annotations: Array<Omit<Annotation, "docId">>;
  notes: Array<{ id: string; title: string; body: string; pageIndex: number }>;
};

export type ExportOptions = {
  format: ExportFormat;
  pageRange: string;
  flattenAnnotations: boolean;
  includeAnnotationSummary: boolean;
  imageDpi: number;
  ocr: boolean;
  ocrLanguage: string;
  /** DOCX/DOC output can preserve visual page layout or reconstruct editable text flow. */
  wordLayout: "editable" | "visual";
};

export type Toast = {
  id: string;
  kind: "info" | "success" | "error";
  message: string;
};

export type TextPage = {
  pageIndex: number;
  text: string;
  items: Array<{ str: string; x: number; y: number; width: number; height: number }>;
};

export type SearchHit = {
  docId: string;
  pageIndex: number;
  snippet: string;
  index: number;
};

export type OutlineNode = {
  title: string;
  pageIndex: number;
  bold?: boolean;
  italic?: boolean;
  children: OutlineNode[];
};
