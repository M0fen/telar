import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useGraphStore } from '../store/useGraphStore';

// RED DE SEGURIDAD: si un error de render se propaga sin capturar, React DESMONTA
// todo el árbol → "pantalla negra" de la que no se puede salir (aunque el audio, que
// vive en WebAudio, siga sonando). Antes no había ninguna → un grafo raro (p.ej. uno
// generado por la IA) podía dejar la app en negro sin vuelta atrás.
//
// Dos usos:
//  • RAÍZ (variant "app"): pantalla de recuperación con "deshacer y volver" (Ctrl+Z:
//    revierte la última carga, que quedó en el historial) + "recargar".
//  • NODO (variant "node"): aísla el fallo a ESE nodo (chip de error) para que un
//    source/efecto problemático no tumbe todo el lienzo. Autorrecupera al cambiar la key.

interface Props {
  children: ReactNode;
  variant?: 'app' | 'node' | 'panel';
  label?: string; // etiqueta del nodo/panel
  // variant "panel": callback para CERRAR el panel (resetea también el boundary). Así un
  // fallo en un modal/panel se contiene ahí (el resto de la app sigue viva) y se puede salir.
  onClose?: () => void;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // deja rastro en consola para depurar sin romper la experiencia.
    console.error('[Telar] error de render capturado:', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  private undoAndReset = () => {
    const st = useGraphStore.getState();
    // revierte hasta salir del estado que rompía (varias veces por si acaso).
    for (let i = 0; i < 3 && st.past.length; i++) useGraphStore.getState().undo();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.variant === 'node') {
      return (
        <div className="tn-node-error nodrag" onClick={this.reset} title="reintentar dibujar este nodo">
          ⚠ error al dibujar{this.props.label ? ` · ${this.props.label}` : ''}
          <span>clic para reintentar</span>
        </div>
      );
    }

    // PANEL: el fallo se queda en este panel; la app y los demás paneles siguen vivos.
    if (this.props.variant === 'panel') {
      const close = () => { this.props.onClose?.(); this.reset(); };
      return (
        <div className="panel-error" role="alert">
          <div className="panel-error-card">
            <span className="panel-error-mark">⚠</span>
            <div className="panel-error-txt">
              <b>«{this.props.label ?? 'panel'}» falló</b>
              <span>El resto de Telar sigue funcionando. La música no se detiene.</span>
            </div>
            <div className="panel-error-actions">
              {this.props.onClose && <button className="panel-error-primary" onClick={close}>cerrar</button>}
              <button className="panel-error-ghost" onClick={this.reset}>reintentar</button>
              <button className="panel-error-ghost" onClick={() => window.location.reload()}>recargar</button>
            </div>
            <pre className="panel-error-detail">{error.message}</pre>
          </div>
        </div>
      );
    }

    return (
      <div className="app-error">
        <div className="app-error-card">
          <div className="app-error-mark">⚠</div>
          <h2>Algo se rompió al dibujar</h2>
          <p>La música sigue sonando. Puedes volver al estado anterior sin perder el trabajo.</p>
          <div className="app-error-actions">
            <button className="app-error-primary" onClick={this.undoAndReset}>↶ deshacer y volver</button>
            <button className="app-error-ghost" onClick={this.reset}>reintentar</button>
            <button className="app-error-ghost" onClick={() => window.location.reload()}>recargar</button>
          </div>
          <pre className="app-error-detail">{error.message}</pre>
        </div>
      </div>
    );
  }
}
