export interface GraphNodePosition {
  x: number;
  y: number;
}

export interface GraphPortDefinition {
  name: string;
  color?: string;
  hoverColor?: string;
  yPercent?: number;
}

export interface GraphCanvasNode {
  id: string;
  position: GraphNodePosition;
  width?: number;
  height?: number;
  outputs?: GraphPortDefinition[];
}

export interface GraphCanvasEdge {
  fromId: string;
  toId: string;
  fromPort?: string;
  color?: string;
  dashed?: boolean;
}

export interface GraphCanvasConfig {
  onNodeSelect?: (nodeId: string | null) => void;
  onNodeMove?: (nodeId: string, position: GraphNodePosition) => void;
  onCanvasClick?: () => void;
  onConnect?: (fromNodeId: string, toNodeId: string, fromPort?: string) => void;
  renderNode: (node: GraphCanvasNode, element: HTMLElement) => void;
  showMinimap?: boolean;
  showPorts?: boolean;
}

export class GraphCanvas {
  private readonly element: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly nodesContainer: HTMLElement;
  private readonly connectionsCanvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly config: GraphCanvasConfig;

  private readonly nodeElements = new Map<string, HTMLElement>();
  private readonly nodes = new Map<string, GraphCanvasNode>();
  private readonly resizeObserver: ResizeObserver;
  private readonly onWindowMouseUp: () => void;

  private minimapContainer: HTMLElement | null = null;
  private minimapCanvas: HTMLCanvasElement | null = null;
  private minimapCtx: CanvasRenderingContext2D | null = null;

  private connections: GraphCanvasEdge[] = [];
  private selectedNodeId: string | null = null;

  private panX = 0;
  private panY = 0;
  private zoom = 1;

  private isPanning = false;
  private isDraggingNode = false;
  private isDraggingMinimap = false;
  private isDraggingConnection = false;
  private dragNodeId: string | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragNodeStartX = 0;
  private dragNodeStartY = 0;

  private connectionFromNodeId: string | null = null;
  private connectionMouseX = 0;
  private connectionMouseY = 0;
  private connectionFromPort: string | null = null;
  private connectionFromPortYPercent = 0.5;

  private readonly MINIMAP_SIZE = 150;
  private readonly MINIMAP_PADDING = 10;

  constructor(config: GraphCanvasConfig) {
    this.config = config;

    this.element = document.createElement("div");
    this.element.className = "sm-graph-canvas";
    this.element.style.cssText = `
      width: 100%;
      height: 100%;
      position: relative;
      overflow: hidden;
      background: #1e1e2e;
      cursor: grab;
      background-image: radial-gradient(circle, #313244 1px, transparent 1px);
      background-size: 20px 20px;
    `;

    this.viewport = document.createElement("div");
    this.viewport.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: 0 0;
    `;
    this.element.appendChild(this.viewport);

    this.connectionsCanvas = document.createElement("canvas");
    this.connectionsCanvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
      width: 2000px;
      height: 2000px;
    `;
    this.connectionsCanvas.width = 2000;
    this.connectionsCanvas.height = 2000;
    this.viewport.appendChild(this.connectionsCanvas);
    this.ctx = this.connectionsCanvas.getContext("2d")!;

    this.nodesContainer = document.createElement("div");
    this.nodesContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
    `;
    this.viewport.appendChild(this.nodesContainer);

    if (config.showMinimap !== false) {
      this.createMinimap();
    }

    this.onWindowMouseUp = () => {
      if (this.isDraggingNode && this.dragNodeId) {
        const node = this.nodes.get(this.dragNodeId);
        if (node) {
          this.config.onNodeMove?.(this.dragNodeId, { ...node.position });
        }
      }

      if (this.isDraggingConnection) {
        this.isDraggingConnection = false;
        this.connectionFromNodeId = null;
        this.connectionFromPort = null;
        this.connectionFromPortYPercent = 0.5;
        this.renderEdges();
      }

      this.isPanning = false;
      this.isDraggingNode = false;
      this.isDraggingMinimap = false;
      this.dragNodeId = null;
      this.element.style.cursor = "grab";
    };

    this.setupEventListeners();

    this.resizeObserver = new ResizeObserver(() => {
      this.resizeConnectionsCanvas();
      this.renderEdges();
    });
    this.resizeObserver.observe(this.element);
  }

  getElement(): HTMLElement {
    return this.element;
  }

  dispose(): void {
    window.removeEventListener("mouseup", this.onWindowMouseUp);
    this.resizeObserver.disconnect();
  }

  setNodes(nodes: GraphCanvasNode[]): void {
    this.nodes.clear();
    for (const node of nodes) {
      this.nodes.set(node.id, node);
    }
    this.renderNodes();
  }

  setEdges(edges: GraphCanvasEdge[]): void {
    this.connections = edges;
    this.renderEdges();
  }

  setSelectedNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
    this.updateNodeSelection();
  }

  centerOnNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    const rect = this.element.getBoundingClientRect();
    this.panX =
      rect.width / 2 - node.position.x * this.zoom - ((node.width ?? 200) / 2) * this.zoom;
    this.panY =
      rect.height / 2 - node.position.y * this.zoom - ((node.height ?? 100) / 2) * this.zoom;
    this.updateTransform();
    this.renderEdges();
  }

  fitToContent(): void {
    if (this.nodes.size === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of this.nodes.values()) {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + (node.width ?? 200));
      maxY = Math.max(maxY, node.position.y + (node.height ?? 100));
    }

    const rect = this.element.getBoundingClientRect();
    const padding = 50;
    const contentWidth = maxX - minX + padding * 2;
    const contentHeight = maxY - minY + padding * 2;

    this.zoom = Math.min(rect.width / contentWidth, rect.height / contentHeight, 1.5);
    this.zoom = Math.max(this.zoom, 0.3);

    this.panX =
      (rect.width - contentWidth * this.zoom) / 2 - minX * this.zoom + padding * this.zoom;
    this.panY =
      (rect.height - contentHeight * this.zoom) / 2 - minY * this.zoom + padding * this.zoom;

    this.updateTransform();
    this.renderEdges();
  }

  private setupEventListeners(): void {
    this.element.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;

      const target = event.target as HTMLElement;
      if (target.classList.contains("sm-graph-port-output")) {
        event.stopPropagation();
        this.isDraggingConnection = true;
        this.connectionFromNodeId = target.dataset.nodeId ?? null;
        this.connectionFromPort = target.dataset.portName ?? null;
        this.connectionFromPortYPercent = parseFloat(
          target.dataset.portYPercent ?? "0.5"
        );
        this.connectionMouseX = event.clientX;
        this.connectionMouseY = event.clientY;
        this.element.style.cursor = "crosshair";
        return;
      }

      if (target.classList.contains("sm-graph-port-input")) {
        return;
      }

      const nodeElement = target.closest("[data-node-id]") as HTMLElement | null;
      if (nodeElement && !target.classList.contains("sm-graph-port")) {
        const nodeId = nodeElement.dataset.nodeId!;
        const node = this.nodes.get(nodeId);
        if (!node) return;

        this.isDraggingNode = true;
        this.dragNodeId = nodeId;
        this.dragStartX = event.clientX;
        this.dragStartY = event.clientY;
        this.dragNodeStartX = node.position.x;
        this.dragNodeStartY = node.position.y;

        this.config.onNodeSelect?.(nodeId);
        this.setSelectedNode(nodeId);
        this.element.style.cursor = "grabbing";
        return;
      }

      this.isPanning = true;
      this.dragStartX = event.clientX - this.panX;
      this.dragStartY = event.clientY - this.panY;
      this.element.style.cursor = "grabbing";
      this.config.onCanvasClick?.();
      this.config.onNodeSelect?.(null);
      this.setSelectedNode(null);
    });

    this.element.addEventListener("mousemove", (event) => {
      if (this.isPanning) {
        this.panX = event.clientX - this.dragStartX;
        this.panY = event.clientY - this.dragStartY;
        this.updateTransform();
        this.renderEdges();
        return;
      }

      if (this.isDraggingNode && this.dragNodeId) {
        const node = this.nodes.get(this.dragNodeId);
        if (!node) return;

        const dx = (event.clientX - this.dragStartX) / this.zoom;
        const dy = (event.clientY - this.dragStartY) / this.zoom;
        node.position.x = this.dragNodeStartX + dx;
        node.position.y = this.dragNodeStartY + dy;

        const nodeElement = this.nodeElements.get(this.dragNodeId);
        if (nodeElement) {
          nodeElement.style.left = `${node.position.x}px`;
          nodeElement.style.top = `${node.position.y}px`;
        }

        this.renderEdges();
        return;
      }

      if (this.isDraggingConnection) {
        this.connectionMouseX = event.clientX;
        this.connectionMouseY = event.clientY;
        this.renderEdges();
      }
    });

    this.element.addEventListener("mouseup", (event) => {
      if (!this.isDraggingConnection || !this.connectionFromNodeId) return;

      const target = event.target as HTMLElement;
      if (target.classList.contains("sm-graph-port-input")) {
        const toNodeId = target.dataset.nodeId!;
        if (toNodeId !== this.connectionFromNodeId) {
          this.config.onConnect?.(
            this.connectionFromNodeId,
            toNodeId,
            this.connectionFromPort ?? undefined
          );
        }
      }

      this.isDraggingConnection = false;
      this.connectionFromNodeId = null;
      this.connectionFromPort = null;
      this.connectionFromPortYPercent = 0.5;
      this.renderEdges();
      this.element.style.cursor = "grab";
    });

    window.addEventListener("mouseup", this.onWindowMouseUp);

    this.element.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();

        const rect = this.element.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        const canvasX = (mouseX - this.panX) / this.zoom;
        const canvasY = (mouseY - this.panY) / this.zoom;

        const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
        this.zoom = Math.max(0.2, Math.min(3, this.zoom * zoomFactor));
        this.panX = mouseX - canvasX * this.zoom;
        this.panY = mouseY - canvasY * this.zoom;

        this.updateTransform();
        this.renderEdges();
      },
      { passive: false }
    );
  }

  private updateTransform(): void {
    this.viewport.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    const gridSize = 20 * this.zoom;
    this.element.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    this.element.style.backgroundPosition = `${this.panX}px ${this.panY}px`;
  }

  private resizeConnectionsCanvas(): void {
    let maxX = 0;
    let maxY = 0;
    for (const node of this.nodes.values()) {
      maxX = Math.max(maxX, node.position.x + (node.width ?? 200) + 500);
      maxY = Math.max(maxY, node.position.y + (node.height ?? 100) + 500);
    }

    const width = Math.max(maxX, 2000);
    const height = Math.max(maxY, 2000);
    this.connectionsCanvas.width = width;
    this.connectionsCanvas.height = height;
    this.connectionsCanvas.style.width = `${width}px`;
    this.connectionsCanvas.style.height = `${height}px`;
  }

  private renderNodes(): void {
    this.nodesContainer.innerHTML = "";
    this.nodeElements.clear();

    for (const node of this.nodes.values()) {
      const nodeElement = document.createElement("div");
      nodeElement.dataset.nodeId = node.id;
      nodeElement.style.cssText = `
        position: absolute;
        left: ${node.position.x}px;
        top: ${node.position.y}px;
        min-width: 180px;
        background: #181825;
        border: 2px solid #313244;
        border-radius: 8px;
        cursor: move;
        user-select: none;
      `;

      this.config.renderNode(node, nodeElement);

      if (this.config.showPorts !== false) {
        const inputPort = document.createElement("div");
        inputPort.className = "sm-graph-port sm-graph-port-input";
        inputPort.dataset.nodeId = node.id;
        inputPort.style.cssText = `
          position: absolute;
          left: -6px;
          top: 50%;
          transform: translateY(-50%);
          width: 12px;
          height: 12px;
          background: #313244;
          border: 2px solid #45475a;
          border-radius: 50%;
          cursor: crosshair;
          z-index: 10;
          transition: all 0.15s;
        `;
        inputPort.onmouseenter = () => {
          inputPort.style.background = "#89b4fa";
          inputPort.style.borderColor = "#89b4fa";
          inputPort.style.transform = "translateY(-50%) scale(1.3)";
        };
        inputPort.onmouseleave = () => {
          inputPort.style.background = "#313244";
          inputPort.style.borderColor = "#45475a";
          inputPort.style.transform = "translateY(-50%) scale(1)";
        };
        nodeElement.appendChild(inputPort);

        if (node.outputs && node.outputs.length > 0) {
          for (const output of node.outputs) {
            const port = document.createElement("div");
            const portColor = output.color ?? "#313244";
            const portBorder = output.color ?? "#45475a";
            const portHover = output.hoverColor ?? output.color ?? "#a6e3a1";
            port.className = "sm-graph-port sm-graph-port-output";
            port.dataset.nodeId = node.id;
            port.dataset.portName = output.name;
            port.dataset.portYPercent = String(output.yPercent ?? 0.5);
            port.style.cssText = `
              position: absolute;
              right: -6px;
              top: ${(output.yPercent ?? 0.5) * 100}%;
              transform: translateY(-50%);
              width: 12px;
              height: 12px;
              background: ${portColor};
              border: 2px solid ${portBorder};
              border-radius: 50%;
              cursor: crosshair;
              z-index: 10;
              transition: all 0.15s;
            `;
            port.onmouseenter = () => {
              port.style.background = portHover;
              port.style.borderColor = portHover;
              port.style.transform = "translateY(-50%) scale(1.3)";
            };
            port.onmouseleave = () => {
              port.style.background = portColor;
              port.style.borderColor = portBorder;
              port.style.transform = "translateY(-50%) scale(1)";
            };
            nodeElement.appendChild(port);
          }
        } else {
          const outputPort = document.createElement("div");
          outputPort.className = "sm-graph-port sm-graph-port-output";
          outputPort.dataset.nodeId = node.id;
          outputPort.style.cssText = `
            position: absolute;
            right: -6px;
            top: 50%;
            transform: translateY(-50%);
            width: 12px;
            height: 12px;
            background: #313244;
            border: 2px solid #45475a;
            border-radius: 50%;
            cursor: crosshair;
            z-index: 10;
            transition: all 0.15s;
          `;
          outputPort.onmouseenter = () => {
            outputPort.style.background = "#a6e3a1";
            outputPort.style.borderColor = "#a6e3a1";
            outputPort.style.transform = "translateY(-50%) scale(1.3)";
          };
          outputPort.onmouseleave = () => {
            outputPort.style.background = "#313244";
            outputPort.style.borderColor = "#45475a";
            outputPort.style.transform = "translateY(-50%) scale(1)";
          };
          nodeElement.appendChild(outputPort);
        }
      }

      this.nodesContainer.appendChild(nodeElement);
      this.nodeElements.set(node.id, nodeElement);
    }

    this.updateNodeSelection();
    this.resizeConnectionsCanvas();

    requestAnimationFrame(() => {
      for (const [nodeId, nodeElement] of this.nodeElements) {
        const node = this.nodes.get(nodeId);
        if (node) {
          node.width = nodeElement.offsetWidth;
          node.height = nodeElement.offsetHeight;
        }
      }
      this.resizeConnectionsCanvas();
      this.renderEdges();
    });
  }

  private updateNodeSelection(): void {
    for (const [nodeId, nodeElement] of this.nodeElements) {
      if (nodeId === this.selectedNodeId) {
        nodeElement.style.borderColor = "#89b4fa";
        nodeElement.style.boxShadow = "0 0 0 2px #89b4fa44";
      } else {
        nodeElement.style.borderColor = "#313244";
        nodeElement.style.boxShadow = "none";
      }
    }
  }

  private renderEdges(): void {
    this.ctx.clearRect(0, 0, this.connectionsCanvas.width, this.connectionsCanvas.height);

    for (const edge of this.connections) {
      const fromNode = this.nodes.get(edge.fromId);
      const toNode = this.nodes.get(edge.toId);
      if (!fromNode || !toNode) continue;

      let fromYPercent = 0.5;
      if (edge.fromPort && fromNode.outputs) {
        const port = fromNode.outputs.find((output) => output.name === edge.fromPort);
        if (port?.yPercent !== undefined) {
          fromYPercent = port.yPercent;
        }
      }

      const fromX = fromNode.position.x + (fromNode.width ?? 180);
      const fromY = fromNode.position.y + (fromNode.height ?? 50) * fromYPercent;
      const toX = toNode.position.x;
      const toY = toNode.position.y + (toNode.height ?? 50) / 2;

      this.ctx.beginPath();
      this.ctx.strokeStyle = edge.color ?? "#45475a";
      this.ctx.lineWidth = 2;
      if (edge.dashed) this.ctx.setLineDash([6, 4]);
      const controlOffset = Math.min(100, Math.abs(toX - fromX) / 2);
      this.ctx.moveTo(fromX, fromY);
      this.ctx.bezierCurveTo(
        fromX + controlOffset,
        fromY,
        toX - controlOffset,
        toY,
        toX,
        toY
      );
      this.ctx.stroke();
      if (edge.dashed) this.ctx.setLineDash([]);

      const angle = Math.atan2(0, controlOffset);
      const arrowSize = 8;
      this.ctx.beginPath();
      this.ctx.fillStyle = edge.color ?? "#45475a";
      this.ctx.moveTo(toX, toY);
      this.ctx.lineTo(
        toX - arrowSize * Math.cos(angle - Math.PI / 6),
        toY - arrowSize * Math.sin(angle - Math.PI / 6)
      );
      this.ctx.lineTo(
        toX - arrowSize * Math.cos(angle + Math.PI / 6),
        toY - arrowSize * Math.sin(angle + Math.PI / 6)
      );
      this.ctx.closePath();
      this.ctx.fill();
    }

    if (this.isDraggingConnection && this.connectionFromNodeId) {
      const fromNode = this.nodes.get(this.connectionFromNodeId);
      if (fromNode) {
        const fromX = fromNode.position.x + (fromNode.width ?? 180);
        const fromY =
          fromNode.position.y + (fromNode.height ?? 50) * this.connectionFromPortYPercent;
        const rect = this.element.getBoundingClientRect();
        const toX = (this.connectionMouseX - rect.left - this.panX) / this.zoom;
        const toY = (this.connectionMouseY - rect.top - this.panY) / this.zoom;
        const dragColor = this.connectionFromPort === "fail" ? "#f38ba8" : "#89b4fa";

        this.ctx.beginPath();
        this.ctx.strokeStyle = dragColor;
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        const controlOffset = Math.min(100, Math.abs(toX - fromX) / 2);
        this.ctx.moveTo(fromX, fromY);
        this.ctx.bezierCurveTo(
          fromX + controlOffset,
          fromY,
          toX - controlOffset,
          toY,
          toX,
          toY
        );
        this.ctx.stroke();
        this.ctx.setLineDash([]);
      }
    }

    this.renderMinimap();
  }

  private createMinimap(): void {
    this.minimapContainer = document.createElement("div");
    this.minimapContainer.style.cssText = `
      position: absolute;
      bottom: ${this.MINIMAP_PADDING}px;
      right: ${this.MINIMAP_PADDING}px;
      width: ${this.MINIMAP_SIZE}px;
      height: ${this.MINIMAP_SIZE}px;
      background: #181825;
      border: 1px solid #313244;
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;

    this.minimapCanvas = document.createElement("canvas");
    this.minimapCanvas.width = this.MINIMAP_SIZE;
    this.minimapCanvas.height = this.MINIMAP_SIZE;
    this.minimapCanvas.style.cssText = "width: 100%; height: 100%;";
    this.minimapCtx = this.minimapCanvas.getContext("2d")!;
    this.minimapContainer.appendChild(this.minimapCanvas);
    this.element.appendChild(this.minimapContainer);

    this.minimapContainer.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      this.isDraggingMinimap = true;
      this.navigateFromMinimap(event);
    });

    this.minimapContainer.addEventListener("mousemove", (event) => {
      if (this.isDraggingMinimap) {
        this.navigateFromMinimap(event);
      }
    });
  }

  private navigateFromMinimap(event: MouseEvent): void {
    if (!this.minimapContainer || this.nodes.size === 0) return;

    const rect = this.minimapContainer.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    const bounds = this.getContentBounds();
    if (!bounds) return;

    const padding = 20;
    const contentWidth = bounds.maxX - bounds.minX + padding * 2;
    const contentHeight = bounds.maxY - bounds.minY + padding * 2;
    const scale = Math.min(this.MINIMAP_SIZE / contentWidth, this.MINIMAP_SIZE / contentHeight);
    const offsetX = (this.MINIMAP_SIZE - contentWidth * scale) / 2;
    const offsetY = (this.MINIMAP_SIZE - contentHeight * scale) / 2;
    const contentX = (clickX - offsetX) / scale + bounds.minX - padding;
    const contentY = (clickY - offsetY) / scale + bounds.minY - padding;

    const elementRect = this.element.getBoundingClientRect();
    this.panX = elementRect.width / 2 - contentX * this.zoom;
    this.panY = elementRect.height / 2 - contentY * this.zoom;
    this.updateTransform();
    this.renderEdges();
  }

  private renderMinimap(): void {
    if (!this.minimapCtx || !this.minimapCanvas) return;
    const bounds = this.getContentBounds();
    const ctx = this.minimapCtx;
    ctx.clearRect(0, 0, this.MINIMAP_SIZE, this.MINIMAP_SIZE);
    ctx.fillStyle = "#11111b";
    ctx.fillRect(0, 0, this.MINIMAP_SIZE, this.MINIMAP_SIZE);
    if (!bounds) return;

    const padding = 20;
    const contentWidth = bounds.maxX - bounds.minX + padding * 2;
    const contentHeight = bounds.maxY - bounds.minY + padding * 2;
    const scale = Math.min(this.MINIMAP_SIZE / contentWidth, this.MINIMAP_SIZE / contentHeight);
    const offsetX = (this.MINIMAP_SIZE - contentWidth * scale) / 2;
    const offsetY = (this.MINIMAP_SIZE - contentHeight * scale) / 2;

    for (const node of this.nodes.values()) {
      const x = offsetX + (node.position.x - bounds.minX + padding) * scale;
      const y = offsetY + (node.position.y - bounds.minY + padding) * scale;
      const width = (node.width ?? 200) * scale;
      const height = (node.height ?? 100) * scale;
      ctx.fillStyle = node.id === this.selectedNodeId ? "#89b4fa" : "#6c7086";
      ctx.fillRect(x, y, width, height);
    }

    const viewWidth = this.element.clientWidth / this.zoom;
    const viewHeight = this.element.clientHeight / this.zoom;
    const viewX = -this.panX / this.zoom;
    const viewY = -this.panY / this.zoom;
    ctx.strokeStyle = "#f9e2af";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      offsetX + (viewX - bounds.minX + padding) * scale,
      offsetY + (viewY - bounds.minY + padding) * scale,
      viewWidth * scale,
      viewHeight * scale
    );
  }

  private getContentBounds():
    | { minX: number; minY: number; maxX: number; maxY: number }
    | null {
    if (this.nodes.size === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of this.nodes.values()) {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + (node.width ?? 200));
      maxY = Math.max(maxY, node.position.y + (node.height ?? 100));
    }

    return { minX, minY, maxX, maxY };
  }
}
