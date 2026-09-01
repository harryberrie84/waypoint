import { useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Images, Plus, X, Loader2 } from 'lucide-react';
import { uid } from '../lib/id';
import { uploadsApi } from '../lib/api';
import { processImageFile } from '../lib/image';
import { MediaPreview } from '../components/MediaPreview';
import type { MediaItem } from '../lib/tripViews';
import { toast } from '../store/useToast';

// galleryBlock, an inline grid of images inside a page body (a photo dump in a
// journal entry), distinct from the page-scoped Moodboard tab. Click one to open
// it big in the shared MediaPreview. Images upload full-size to the uploads
// collection (small ones fall back to an inline data URL), the same as the /audio
// and Files-tab paths. Each image's data lives in the `items` JSON attr.

interface GalleryImage {
  id: string;
  src: string;
  alt?: string;
}

async function uploadImage(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null;
  return (await uploadsApi.upload(file)) ?? (await processImageFile(file).catch(() => null));
}

function GalleryView({ node, updateAttributes, editor }: NodeViewProps) {
  const editable = editor.isEditable;
  const items: GalleryImage[] = Array.isArray(node.attrs.items) ? (node.attrs.items as GalleryImage[]) : [];
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<MediaItem | null>(null);

  const write = (next: GalleryImage[]) => updateAttributes({ items: next });

  const pick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const added: GalleryImage[] = [];
      for (const file of Array.from(files)) {
        const src = await uploadImage(file);
        if (src) added.push({ id: uid(), src, alt: file.name });
        else toast(`Could not add ${file.name}.`, 'error');
      }
      if (added.length) write([...items, ...added]);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = (id: string) => write(items.filter((it) => it.id !== id));

  const AddButton = ({ label }: { label: string }) => (
    <button
      type="button"
      disabled={uploading}
      onClick={() => inputRef.current?.click()}
      className="flex items-center gap-1.5 rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay/90 disabled:opacity-60"
    >
      {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
      {uploading ? 'Adding…' : label}
    </button>
  );

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void pick(e.target.files)} />
      <div className="overflow-hidden rounded-2xl border border-paper-line bg-paper-panel/30 dark:border-coal-line dark:bg-coal/30">
        <div className="flex items-center gap-2 border-b border-paper-line px-3 py-2 dark:border-coal-line">
          <Images className="h-4 w-4 shrink-0 text-clay" />
          <span className="text-sm font-medium text-ink dark:text-coal-text">Gallery</span>
          <span className="text-[11px] text-ink-faint dark:text-coal-soft">
            {items.length} image{items.length === 1 ? '' : 's'}
          </span>
          {editable && items.length > 0 && (
            <span className="ml-auto">
              <AddButton label="Add" />
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <p className="text-sm text-ink-faint dark:text-coal-soft">{editable ? 'A grid of photos for this page.' : 'No images.'}</p>
            {editable && <AddButton label="Add images" />}
          </div>
        ) : (
          <div className="columns-2 gap-2 p-2 sm:columns-3 [&>*]:mb-2">
            {items.map((it) => (
              <div key={it.id} className="group relative break-inside-avoid overflow-hidden rounded-lg">
                <button
                  type="button"
                  onClick={() => setPreview({ key: it.id, name: it.alt || 'Image', url: it.src, mime: '', size: 0, isImage: true, isAudio: false, source: 'Gallery' })}
                  className="block w-full"
                  title="Open"
                >
                  <img src={it.src} alt={it.alt || ''} loading="lazy" className="w-full rounded-lg border border-paper-line object-cover transition-transform duration-300 group-hover:scale-[1.02] dark:border-coal-line" />
                </button>
                {editable && (
                  <button
                    type="button"
                    onClick={() => remove(it.id)}
                    title="Remove"
                    className="absolute right-1.5 top-1.5 rounded-md bg-black/50 p-1 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <MediaPreview item={preview} onClose={() => setPreview(null)} />
    </NodeViewWrapper>
  );
}

export const GalleryBlock = Node.create({
  name: 'galleryBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      items: {
        default: [],
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute('data-items') || '[]');
          } catch {
            return [];
          }
        },
        renderHTML: (attrs: { items?: GalleryImage[] }) => ({ 'data-items': JSON.stringify(attrs.items || []) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-gallery]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-gallery': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(GalleryView);
  },
});
