import { useRef } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Paperclip, FileText, FileImage, File as FileIcon, Download, X } from 'lucide-react';
import { processAttachmentFile, FileTooLargeError, formatBytes } from '../lib/image';
import { toast } from '../store/useToast';

// fileBlock, a general attachment (PDF, ticket, boarding pass…) embedded as a
// base64 data URL in the doc JSON, the same way images are (see lib/image.ts).
// Empty until a file is picked; then it's a download chip. No PB file storage,
// so the ~1.5MB cap from processAttachmentFile applies.

function iconFor(mime: string) {
  if (mime.startsWith('image/')) return FileImage;
  if (mime === 'application/pdf' || mime.startsWith('text/')) return FileText;
  return FileIcon;
}

function FileView({ node, updateAttributes, editor }: NodeViewProps) {
  const name = node.attrs.name as string;
  const mime = node.attrs.mime as string;
  const size = node.attrs.size as number;
  const data = node.attrs.data as string;
  const editable = editor.isEditable;
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (file: File | undefined) => {
    if (!file) return;
    void processAttachmentFile(file)
      .then((a) => updateAttributes({ name: a.name, mime: a.mime, size: a.size, data: a.data }))
      .catch((err) => toast(err instanceof FileTooLargeError ? err.message : 'Could not read that file.', 'error'));
  };

  if (!data) {
    return (
      <NodeViewWrapper className="my-3" contentEditable={false}>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <div className="rounded-xl border border-paper-line bg-paper-panel/50 p-3 dark:border-coal-line dark:bg-coal/40">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-faint dark:text-coal-soft">
            <Paperclip className="h-3.5 w-3.5 text-clay" /> Attach a file
          </div>
          {editable ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90"
            >
              Choose file
            </button>
          ) : (
            <p className="text-sm text-ink-faint dark:text-coal-soft">No file attached.</p>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  const Icon = iconFor(mime);
  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <input ref={inputRef} type="file" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <div className="flex items-center gap-3 rounded-xl border border-paper-line bg-paper p-3 dark:border-coal-line dark:bg-coal-panel">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-clay-wash text-clay dark:bg-clay/15">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink dark:text-coal-text">{name}</div>
          <div className="text-[11px] text-ink-faint dark:text-coal-soft">{formatBytes(size)}</div>
        </div>
        <a
          href={data}
          download={name}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-paper-line px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:border-clay/50 hover:text-clay dark:border-coal-line dark:text-coal-soft"
        >
          <Download className="h-3.5 w-3.5" /> Download
        </a>
        {editable && (
          <button
            type="button"
            onClick={() => updateAttributes({ name: '', mime: '', size: 0, data: '' })}
            className="shrink-0 rounded-lg p-1.5 text-ink-faint hover:text-clay"
            title="Remove file"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const FileBlock = Node.create({
  name: 'fileBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      name: { default: '' },
      mime: { default: '' },
      size: { default: 0 },
      data: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-file]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-file': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileView);
  },
});
