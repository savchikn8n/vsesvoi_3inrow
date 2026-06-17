(function initBoardRenderer(globalScope, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.VSBoardRenderer = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBoardRenderer() {
  'use strict';

  function tileClassListForCell(cell, state = {}) {
    if (!cell) return ['empty'];

    const classes = [`type-${cell.color}`];
    if (cell.special) classes.push(`special-${cell.special}`);
    if (state.falling) classes.push('falling');
    return classes;
  }

  function boardRenderModel(board, options = {}) {
    const selected = options.selected;
    const highlight = options.highlight || new Set();
    const blast = options.blast || new Set();
    const hintMove = options.hintMove || null;
    const locked = Boolean(options.locked);
    const directionClass = options.directionClass || (() => '');
    const hintDirection = hintMove ? directionClass(hintMove.from, hintMove.to) : '';
    const boardSize = inferBoardSize(board);

    return board.map((cell, index) => {
      const fallDistance = cell && cell._fall > 0 ? cell._fall : 0;
      const row = Math.floor(index / boardSize);
      const col = index % boardSize;
      const popDelayMs = Math.min(row + col, 6) * 8;
      const dropDelayMs = col * 6;
      const classes = tileClassListForCell(cell, { falling: fallDistance > 0 });

      if (selected === index) classes.push('selected');
      if (highlight.has(index)) classes.push('match');
      if (blast.has(index)) classes.push('blast');

      if (!locked && hintMove) {
        if (index === hintMove.from) {
          classes.push('hint-source');
          if (hintDirection) classes.push(hintDirection);
        } else if (index === hintMove.to) {
          classes.push('hint-target');
        }
      }

      return {
        cell,
        classes,
        fallDistance,
        row,
        col,
        popDelayMs,
        dropDelayMs,
        index,
      };
    });
  }

  function inferBoardSize(board) {
    const size = Math.sqrt(board.length);
    return Number.isInteger(size) && size > 0 ? size : 7;
  }

  function cloneTile(tileTemplate) {
    const source = tileTemplate?.content?.firstElementChild || tileTemplate?.firstElementChild;
    if (!source) {
      throw new Error('Missing tile template element');
    }
    return source.cloneNode(true);
  }

  function addListener(tile, eventName, handler) {
    if (typeof handler === 'function') {
      tile.addEventListener(eventName, handler);
    }
  }

  function renderBoardDom(options = {}) {
    const {
      boardEl,
      tileTemplate,
      board,
      selected,
      highlight,
      blast,
      hintMove,
      locked,
      directionClass,
      onTileClick,
      onTilePointerDown,
      onTilePointerMove,
      onTilePointerEnd,
    } = options;

    if (!boardEl) throw new Error('Missing board element');
    if (!Array.isArray(board)) throw new Error('Missing board array');

    const model = boardRenderModel(board, {
      selected,
      highlight,
      blast,
      hintMove,
      locked,
      directionClass,
    });

    boardEl.innerHTML = '';

    model.forEach((item) => {
      const tile = cloneTile(tileTemplate);
      item.classes.forEach((className) => tile.classList.add(className));
      tile.dataset.index = String(item.index);
      tile.style.setProperty('--tile-row', String(item.row));
      tile.style.setProperty('--tile-col', String(item.col));
      tile.style.setProperty('--tile-pop-delay', `${item.popDelayMs}ms`);
      tile.style.setProperty('--tile-drop-delay', `${item.dropDelayMs}ms`);

      if (item.fallDistance > 0) {
        tile.style.setProperty('--fall-distance', String(item.fallDistance));
      }

      addListener(tile, 'click', onTileClick);
      addListener(tile, 'pointerdown', onTilePointerDown);
      addListener(tile, 'pointermove', onTilePointerMove);
      addListener(tile, 'pointerup', onTilePointerEnd);
      addListener(tile, 'pointercancel', onTilePointerEnd);

      boardEl.appendChild(tile);
    });

    return model;
  }

  return {
    boardRenderModel,
    renderBoardDom,
    tileClassListForCell,
  };
});
