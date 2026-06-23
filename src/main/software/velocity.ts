import { makePaperMcProvider } from './papermc'

// Velocity ships through the same PaperMC fill API as Paper.
export const velocity = makePaperMcProvider('velocity', 'velocity')
