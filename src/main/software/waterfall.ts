import { makePaperMcProvider } from './papermc'

// Waterfall is discontinued but still served by the PaperMC fill API.
export const waterfall = makePaperMcProvider('waterfall', 'waterfall')
