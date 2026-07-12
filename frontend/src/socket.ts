/// <reference types="vite/client" />
import io from "socket.io-client";

export const BACKEND_URL = import.meta.env.MODE === "production" ? "" : "http://localhost:3001";

export const socket = io(BACKEND_URL, {
  transports: ["websocket"],
  autoConnect: true,
  path: "/socket.io/",
});

socket.on("connect", () => {
  console.log("Socket connected:", socket.id);
});

socket.on("disconnect", () => {
  console.log("Socket disconnected");
});
