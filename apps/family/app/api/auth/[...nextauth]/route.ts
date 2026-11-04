// NextAuth's endpoints (/api/auth/signin, /callback, /session, /csrf, /signout).
import NextAuth from "next-auth";
import { authOptions } from "@/auth";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
