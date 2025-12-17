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
            console.log("[(DEBUG) Index] Incoming Request to /graphql");
            const authHeader = req.headers.authorization;
            console.log("[(DEBUG) Index] Auth Header:", authHeader ? authHeader.substring(0, 20) + "..." : "None");
            let user = undefined;

            if (authHeader?.startsWith("Bearer ")) {
                const token = authHeader.split("Bearer ")[1];
                const { data: { user: authUser } } = await supabase.auth.getUser(token);

                if (authUser) {
                    // Fetch role from profiles table
                    const { data: profile } = await supabase
                        .from("profiles")
                        .select("role")
                        .eq("id", authUser.id)
                        .single();

                    user = {
                        uid: authUser.id,
                        email: authUser.email,
                        role: profile?.role || 'user'
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
