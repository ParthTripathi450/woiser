import { 
  fetchRequestHandler
} from '@trpc/server/adapters/fetch';
import { createTRPCContext } from '@/trpc/init';
import { appRouter } from '@/trpc/routers/_app';
// TTS generation runs long. Vercel's Hobby tier allows up to 300s with Fluid
// compute enabled; without it the ceiling is 60s.
export const maxDuration = 300;

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: createTRPCContext,
  });
export { handler as GET, handler as POST };