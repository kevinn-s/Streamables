import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createRandomKey } from '..';
interface NavigateStore {
    routes: Array<{ key: string; pattern: string; component: ComponentType<any>; }>;
    entries: Array<string>;
    states: Array<{ key: string; index: number; params?: Record<string, string> }>
    index: number;

    push: (pattern: string, params?: Record<string, string>) => void;
    replace: (pattern: string, params?: Record<string, string>) => void;

    go: (n: number) => void;
    back: () => void;
    forward: () => void;
};

export const useNavigateStore = create<NavigateStore>((set, get) => ({
    routes: [],
    entries: [],
    states: [],
    index: -1,
    push: (pattern, params) =>
        set((s) => {
            const index = s.index + 1;
            return {
                entries: [...s.entries.slice(0, index), pattern],
                states: [
                    ...s.states.slice(0, index),
                    { key: createRandomKey(), index: index, params },
                ],
                index: index,
            };
        }),

    replace: (pattern, params) =>
        set((s) => {
            const index =
                s.entries.length === 0 || s.index < 0
                    ? 0
                    : Math.min(s.index, s.entries.length - 1);

            const entries = [...s.entries];
            const states = [...s.states];

            entries[index] = pattern;
            states[index] = {
                key: createRandomKey(),
                index: index,
                params,
            };

            return {
                entries: entries,
                states: states,
                index: index
            }
        }),

    go: (n) =>
        set((s) =>
            s.entries.length === 0
                ? s
                : { index: Math.max(0, Math.min(s.entries.length - 1, s.index + n)) },
        ),

    back: () => get().go(-1),

    forward: () => get().go(1)

}));

export const useNavigate = () => {
    const { routes, entries, states, index, push, back } = useNavigateStore(
        useShallow((state) => ({
            routes: state.routes, entries: state.entries, states: state.states, index: state.index, push: state.push, back: state.back
        })));
        
    const register = useCallback((route: {
        pattern: string;
        component: ComponentType<any>;
    }) => {
        useNavigateStore.setState((store) => {
            if (store.routes.find((r) => r.pattern === route.pattern)?.component === route.component) {
                return {};
            }

            return {
                routes: [
                    ...store.routes.filter((registered) => registered.pattern !== route.pattern),
                    {
                        key: createRandomKey(),
                        pattern: route.pattern,
                        component: route.component,
                    },
                ],
            };
        });
    }, []);

    const navigate = useCallback(({ to, params }: { to: string, params?: Record<string, string> }) => {
        push(to, params)
    }, [push])

    const out = useMemo(() => {
        const entry = entries[index], state = states[index];
        const route = routes.find(route => route.pattern === entry);

        if (!route) return null;

        const Component = route.component;
        return (
            <Component
                key={route.key ?? route.pattern}
                {...state?.params}
            />
        );
    }, [entries, index, routes, states])

    return ({
        register,
        navigate,
        back,
        out,
    })
};


/**
 * previous planning, abandon!
1. usestate of type array of strings, named "entries".
2. usestate of type number, named "index"
3. const states = entries.map((_entry, index) =>
        assignKeyAndIndex(index, undefined),
    )
4. const getLocation = () => parseHref(entries[index]!, states[index])
5. usecallback or standard function, named "push"
6. usecallback or standard function, named "replace"
5. usecallback or standard function, named "go"
5. usecallback or standard function, named "back"
6. const subscribers = new Set<(opts: SubscriberArgs) => void>()
    // need a more react vanilla version of this = 
    type SubscriberArgs = {
        location: HistoryLocation
        action?: SubscriberHistoryAction //optional
        component: //mimics createRoute component prop
    }
7. const notify = (action: SubscriberHistoryAction) => {
    location = opts.getLocation()
    subscribers.forEach((subscriber) => subscriber({ location, action }))
}
8. React Match equivalent (i'm still confused about this part)
   but i think it would be to store the current route by id.
   check whether if route has component in its prop, if so, mount that component.
9. a useState, type of object, mimics router root, but simpler
10. a function that mimics createRoute()
 
*/
