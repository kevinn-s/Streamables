

export function createRandomKey() {
return (Math.random().toString(36).substring(2) + Date.now().toString(36)).slice(0, 7);
}