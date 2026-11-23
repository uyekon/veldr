// Markdown formatting, indentation, folding and editor keyboard commands.
export const editorFormatMethods = {
  applyMarkdownFormat(type) {
    const editor = this.richEditor;
    if (!editor || this.currentEditorMode === 'source') return;
    if (type === 'indent' || type === 'outdent') return this.changeEditorIndent(type === 'indent' ? 1 : -1);
    if (type === 'toggle') return this.toggleEditorDetails();
    const chain = editor.chain().focus();
    const heading = { h1: 1, h2: 2, h3: 3 }[type];
    if (heading) chain.toggleHeading({ level: heading }).run();
    else if (type === 'bold') chain.toggleBold().run();
    else if (type === 'italic') chain.toggleItalic().run();
    else if (type === 'quote') chain.toggleBlockquote().run();
    else if (type === 'ul') chain.toggleBulletList().run();
    else if (type === 'ol') chain.toggleOrderedList().run();
    else if (type === 'task') chain.toggleTaskList().run();
    else if (type === 'inlineCode') chain.toggleCode().run();
    else if (type === 'codeBlock') chain.toggleCodeBlock().run();
    else if (type === 'table') chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    else if (type === 'link') {
      const href = prompt('链接地址', 'https://');
      if (href) chain.extendMarkRange('link').setLink({ href }).run();
    }
  },

  changeEditorIndent(delta) {
    const editor = this.richEditor;
    if (!editor || this.currentEditorMode === 'source') return false;
    const listItem = editor.isActive('taskItem') ? 'taskItem' : editor.isActive('listItem') ? 'listItem' : null;
    if (listItem) {
      const chain = editor.chain().focus();
      return (delta > 0 ? chain.sinkListItem(listItem) : chain.liftListItem(listItem)).run();
    }
    const { doc, selection } = editor.state;
    const positions = [];
    doc.nodesBetween(selection.from, Math.min(doc.content.size, Math.max(selection.to, selection.from + 1)), (node, position) => {
      if (node.type.name === 'paragraph') positions.push({ node, position });
    });
    const changes = positions.filter(({ node }) => {
      const current = Number(node.attrs.indent) || 0;
      return Math.max(0, Math.min(4, current + delta)) !== current;
    });
    if (!changes.length) return false;
    return editor.commands.command(({ tr, dispatch }) => {
      changes.forEach(({ node, position }) => {
        const indent = Math.max(0, Math.min(4, (Number(node.attrs.indent) || 0) + delta));
        tr.setNodeMarkup(position, undefined, { ...node.attrs, indent });
      });
      dispatch?.(tr);
      return true;
    });
  },

  toggleEditorDetails() {
    const editor = this.richEditor;
    if (!editor || this.currentEditorMode === 'source') return false;
    const { doc, selection } = editor.state;
    const activeDepth = Array.from({ length: selection.$from.depth }, (_, index) => selection.$from.depth - index)
      .find((depth) => selection.$from.node(depth).type.name === 'toggleItem');
    if (activeDepth) {
      const node = selection.$from.node(activeDepth);
      const summary = node.child(0).toJSON().content || [];
      const body = node.child(1).toJSON().content || [];
      return editor.commands.insertContentAt({ from: selection.$from.before(activeDepth), to: selection.$from.after(activeDepth) }, [
        { type: 'paragraph', content: summary }, ...body,
      ]);
    }
    const first = doc.resolve(selection.from);
    const last = doc.resolve(Math.max(selection.from, selection.to - 1));
    const from = first.depth ? first.before(1) : selection.from;
    const to = last.depth ? last.after(1) : selection.to;
    const selected = doc.slice(from, to).content.toJSON();
    const firstBlock = selected[0];
    const summary = firstBlock?.type === 'paragraph' && firstBlock.content?.length
      ? firstBlock.content : [{ type: 'text', text: '折叠标题' }];
    const body = firstBlock?.type === 'paragraph' ? selected.slice(1) : selected;
    return editor.commands.insertContentAt({ from, to }, {
      type: 'toggleItem',
      content: [
        { type: 'toggleSummary', content: summary },
        { type: 'toggleContent', content: body.length ? body : [{ type: 'paragraph' }] },
      ],
    });
  },

  deleteSelectedImage(options = {}) {
    const editor = this.richEditor;
    const selection = editor?.state.selection;
    const selectedImage = selection?.node?.type?.name === 'image';
    if (!editor || this.currentEditorMode === 'source' || !selectedImage) {
      if (!options.silent) this.toast('请先单击需要删除的图片，再按 Delete 或点击删除图片');
      return false;
    }

    const parent = selection.$from.parent;
    if (parent.type.name === 'imageGallery' && parent.childCount === 1) {
      const galleryPosition = selection.$from.before(selection.$from.depth);
      editor.chain().focus().setNodeSelection(galleryPosition).deleteSelection().run();
    } else {
      editor.chain().focus().deleteSelection().run();
    }
    return true;
  },

  handleEditorKeydown(event) {
    const primary = event.ctrlKey || event.metaKey;
    if (!primary) {
      if (event.key === 'Backspace' || event.key === 'Delete') {
        if (this.deleteSelectedImage({ silent: true })) {
          event.preventDefault();
          return true;
        }
      }
      if (event.key === 'Tab') {
        if (this.changeEditorIndent(event.shiftKey ? -1 : 1)) {
          event.preventDefault();
          return true;
        }
      }
      return false;
    }
    if (event.key.toLowerCase() === 's') { event.preventDefault(); this.saveNote({ keepOpen: true }); return true; }
    if (event.key === 'Enter') { event.preventDefault(); this.saveNote(); return true; }
    if (event.key === '/') { event.preventDefault(); this.openShortcutModal(); return true; }
    if (event.key.toLowerCase() === 'k') { event.preventDefault(); this.applyMarkdownFormat('link'); return true; }
    if (event.altKey && ['1', '2', '3'].includes(event.key)) { event.preventDefault(); this.applyMarkdownFormat(`h${event.key}`); return true; }
    if (event.shiftKey && event.key === '7') { event.preventDefault(); this.applyMarkdownFormat('ol'); return true; }
    if (event.shiftKey && event.key === '8') { event.preventDefault(); this.applyMarkdownFormat('ul'); return true; }
    if (event.shiftKey && event.key.toLowerCase() === 'c') { event.preventDefault(); this.applyMarkdownFormat('codeBlock'); return true; }
    if (event.shiftKey && event.key.toLowerCase() === 'x') { event.preventDefault(); this.applyMarkdownFormat('task'); return true; }
    if (event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); this.cycleEditorMode(); return true; }
    return false;
  },

};
