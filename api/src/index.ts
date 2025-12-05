import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { typeDefs } from './graphql/schema';
import { resolvers } from './graphql/resolvers';
import { supabase } from './config/supabase';
import { ContextValue } from './types';

const app = express();
const port = process.env.PORT || 4000;

const server = new ApolloServer<ContextValue>({
    typeDefs,
    resolvers,
});

const startServer = async () => {
    await server.start();

    app.use(cors());
    app.use(express.json());

    app.use('/graphql', expressMiddleware(server, {
        context: async ({ req }) => {
            const authHeader = req.headers.authorization;
            let user = undefined;

            if (authHeader?.startsWith("Bearer ")) {
                const token = authHeader.split("Bearer ")[1];
                const { data: { user: authUser } } = await supabase.auth.getUser(token);

                if (authUser) {
                    const role = authUser.app_metadata?.role || "customer";
                    user = {
                        uid: authUser.id,
                        email: authUser.email,
                        role: role
                    };
                }
            }

            return { user, supabase };
        }
    }));
};

startServer().then(() => {
    if (require.main === module) {
        app.listen(port, () => {
            console.log(`Server ready at http://localhost:${port}/graphql`);
        });
    }
});

export default app;
