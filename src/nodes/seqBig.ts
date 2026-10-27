import { createContext } from 'react';

// EDITOR EN GRANDE (Fase 9.2): el panel de detalle monta el mismo secuenciador del nodo con este
// contexto en true → celdas grandes, una fila elegida con sus carriles (fuerza, roll, probabilidad,
// timing) y las herramientas de patrón a la vista, sin menús por paso.
export const SeqBigContext = createContext(false);
