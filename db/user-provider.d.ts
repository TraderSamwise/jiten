import React from "react";
import { WrappedUserDb } from "./user-db";

export function useUserDb(): WrappedUserDb | null;
export function UserDatabaseProvider(props: {
  userId: string;
  children: React.ReactNode;
}): React.JSX.Element;
