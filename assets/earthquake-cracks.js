(() => {
    'use strict';

    const THUMBNAIL_SELECTOR = '.tl-entry.pub .tl-logo';
    const QUAKE_TARGET_SELECTOR = [
        'header',
        '.tl-entry.pub .tl-logo',
        '.tl-entry.pub .tl-body',
        '.tl-entry.pub .tl-date',
        '.tl-entry:not(.pub)',
        'footer'
    ].join(', ');
    const REPAIR_DELAY_MS = 5000;
    const REPAIR_DURATION_MS = 1800;
    const MAX_PRIMARY_CRACKS_PER_THUMBNAIL = 10;
    const CRACK_LAYERS = [
        {
            color: '18, 17, 16',
            width: 1.5,
            minimumWidth: 0.2,
            alpha: 0.22,
            offsetX: 0.58,
            offsetY: 0.66,
            noiseSeed: 0x68bc21eb,
            visibilitySeed: 0x57a12093,
            coverage: 0.88
        },
        {
            color: '255, 255, 255',
            width: 0.7,
            minimumWidth: 0.14,
            alpha: 0.48,
            offsetX: -0.38,
            offsetY: -0.42,
            noiseSeed: 0x02e5be93,
            visibilitySeed: 0x729c0aed,
            coverage: 0.58
        },
        {
            color: '43, 40, 38',
            width: 0.9,
            minimumWidth: 0.2,
            alpha: 0.62,
            offsetX: 0,
            offsetY: 0,
            noiseSeed: 0x967a889b,
            visibilitySeed: 0x1546bd23,
            coverage: 1
        }
    ];
    const SECONDARY_PATH_STYLES = {
        branch: {
            segmentBase: 2,
            segmentVariance: 3,
            volatility: 0.82,
            stepMinimum: 0.38,
            stepVariance: 1.25,
            roughness: 0.07,
            weight: 0.5,
            startDelay: 100,
            startDelayVariance: 90,
            duration: 280,
            durationVariance: 130
        },
        hairline: {
            segmentBase: 1,
            segmentVariance: 2,
            volatility: 1.05,
            stepMinimum: 0.35,
            stepVariance: 1.35,
            roughness: 0.085,
            weight: 0.25,
            startDelay: 125,
            startDelayVariance: 150,
            duration: 210,
            durationVariance: 120
        }
    };

    const thumbnails = Array.from(document.querySelectorAll(THUMBNAIL_SELECTOR));
    const quakeTargets = Array.from(document.querySelectorAll(QUAKE_TARGET_SELECTOR));
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    if (!thumbnails.length) {
        return;
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'earthquake-crack-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);

    const context = canvas.getContext('2d');
    if (!context) {
        canvas.remove();
        return;
    }

    // Shared effect state. Crack coordinates are stored in document space.
    const impacts = [];
    const thumbnailTimers = new WeakMap();
    let canvasWidth = 1;
    let canvasHeight = 1;
    let animationFrame = 0;
    let repairTimer = 0;
    let repairDeadline = 0;
    let repairStartedAt = 0;
    let quakeAnimations = [];

    // Randomness and geometry -------------------------------------------------

    function seededRandom(seed) {
        let value = seed >>> 0;

        return () => {
            value += 0x6d2b79f5;
            let result = value;
            result = Math.imul(result ^ (result >>> 15), result | 1);
            result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
            return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
        };
    }

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function segmentNoise(seed, index) {
        const random = seededRandom(seed ^ Math.imul(index + 1, 0x9e3779b1));
        return random();
    }

    function allPaths() {
        return impacts.flatMap((impact) => impact.paths);
    }

    function pathsForThumbnail(thumbnail) {
        return impacts
            .filter((impact) => impact.thumbnail === thumbnail)
            .flatMap((impact) => impact.paths);
    }

    function appendJaggedSegment(points, start, end, random, depth = 1, roughness = 0.08) {
        function subdivide(from, to, remainingDepth, amplitude) {
            if (remainingDepth === 0) {
                points.push({ x: to.x, y: to.y });
                return;
            }

            const deltaX = to.x - from.x;
            const deltaY = to.y - from.y;
            const length = Math.max(1, Math.hypot(deltaX, deltaY));
            const offset = (random() - 0.5) * length * amplitude;
            const midpoint = {
                x: (from.x + to.x) / 2 - deltaY / length * offset,
                y: (from.y + to.y) / 2 + deltaX / length * offset
            };

            subdivide(from, midpoint, remainingDepth - 1, amplitude * 0.72);
            subdivide(midpoint, to, remainingDepth - 1, amplitude * 0.72);
        }

        subdivide(start, end, depth, roughness);
    }

    function fractureTurn(heading, random, volatility = 1) {
        const drift = (random() - 0.5) * 0.38 * volatility;

        if (random() < 0.23) {
            const direction = random() < 0.5 ? -1 : 1;
            return heading + drift + direction * (0.28 + random() * 0.62) * volatility;
        }

        return heading + drift;
    }

    function segmentIntersection(startA, endA, startB, endB) {
        const directionAX = endA.x - startA.x;
        const directionAY = endA.y - startA.y;
        const directionBX = endB.x - startB.x;
        const directionBY = endB.y - startB.y;
        const denominator = directionAX * directionBY - directionAY * directionBX;

        if (Math.abs(denominator) < 0.0001) {
            return null;
        }

        const deltaX = startB.x - startA.x;
        const deltaY = startB.y - startA.y;
        const progressA = (deltaX * directionBY - deltaY * directionBX) / denominator;
        const progressB = (deltaX * directionAY - deltaY * directionAX) / denominator;

        if (progressA <= 0.035 || progressA >= 0.995 || progressB < 0 || progressB > 1) {
            return null;
        }

        return {
            x: startA.x + directionAX * progressA,
            y: startA.y + directionAY * progressA,
            progress: progressA
        };
    }

    function firstIntersection(start, end, colliders, ignoredPath = null) {
        const candidateLength = Math.hypot(end.x - start.x, end.y - start.y);
        let nearest = null;

        colliders.forEach((path) => {
            if (path === ignoredPath || path.points.length < 2) {
                return;
            }

            for (let index = 0; index < path.points.length - 1; index += 1) {
                const hit = segmentIntersection(start, end, path.points[index], path.points[index + 1]);

                if (!hit || hit.progress * candidateLength < 7) {
                    continue;
                }

                if (!nearest || hit.progress < nearest.progress) {
                    nearest = hit;
                }
            }
        });

        return nearest;
    }

    function appendCrackStep(points, start, end, random, colliders, ignoredPath = null, roughness = 0.055) {
        const jaggedPoints = [];
        const depth = random() < 0.34 ? 2 : 1;
        appendJaggedSegment(
            jaggedPoints,
            start,
            end,
            random,
            depth,
            roughness * (0.65 + random() * 0.9)
        );
        let segmentStart = start;

        for (const segmentEnd of jaggedPoints) {
            const hit = firstIntersection(segmentStart, segmentEnd, colliders, ignoredPath);

            if (hit) {
                points.push({ x: hit.x, y: hit.y });
                return { x: hit.x, y: hit.y, stopped: true };
            }

            points.push(segmentEnd);
            segmentStart = segmentEnd;
        }

        return { x: end.x, y: end.y, stopped: false };
    }

    // Document-space positioning ---------------------------------------------

    function pageRect(element) {
        const rect = element.getBoundingClientRect();
        return {
            left: rect.left + window.scrollX,
            top: rect.top + window.scrollY,
            right: rect.right + window.scrollX,
            bottom: rect.bottom + window.scrollY,
            width: rect.width,
            height: rect.height
        };
    }

    function borderPointAt(rect, progress) {
        const perimeter = 2 * (rect.width + rect.height);
        let distance = (((progress % 1) + 1) % 1) * perimeter;

        if (distance <= rect.width) {
            return { x: rect.left + distance, y: rect.top, angle: -Math.PI / 2 };
        }

        distance -= rect.width;
        if (distance <= rect.height) {
            return { x: rect.right, y: rect.top + distance, angle: 0 };
        }

        distance -= rect.height;
        if (distance <= rect.width) {
            return { x: rect.right - distance, y: rect.bottom, angle: Math.PI / 2 };
        }

        distance -= rect.width;
        return { x: rect.left, y: rect.bottom - distance, angle: Math.PI };
    }

    function closestBorderPoint(rect, x, y) {
        const clampedX = clamp(x, rect.left, rect.right);
        const clampedY = clamp(y, rect.top, rect.bottom);
        const candidates = [
            { x: clampedX, y: rect.top, angle: -Math.PI / 2, distance: Math.abs(y - rect.top) },
            { x: rect.right, y: clampedY, angle: 0, distance: Math.abs(rect.right - x) },
            { x: clampedX, y: rect.bottom, angle: Math.PI / 2, distance: Math.abs(rect.bottom - y) },
            { x: rect.left, y: clampedY, angle: Math.PI, distance: Math.abs(x - rect.left) }
        ];

        return candidates.reduce((closest, candidate) => (
            candidate.distance < closest.distance ? candidate : closest
        ));
    }

    function borderProgress(rect, point) {
        const perimeter = 2 * (rect.width + rect.height);
        let distance;

        if (point.y === rect.top) {
            distance = point.x - rect.left;
        } else if (point.x === rect.right) {
            distance = rect.width + point.y - rect.top;
        } else if (point.y === rect.bottom) {
            distance = rect.width + rect.height + rect.right - point.x;
        } else {
            distance = rect.width * 2 + rect.height + rect.bottom - point.y;
        }

        return distance / perimeter;
    }

    // Crack construction ------------------------------------------------------

    function createSecondaryPath(origin, angle, reach, random, now, colliders, style) {
        const {
            segmentBase,
            segmentVariance,
            volatility,
            stepMinimum,
            stepVariance,
            roughness,
            weight,
            startDelay,
            startDelayVariance,
            duration,
            durationVariance
        } = style;
        const points = [{ x: origin.x, y: origin.y }];
        const segmentCount = segmentBase + Math.floor(random() * segmentVariance);
        let x = origin.x;
        let y = origin.y;
        let heading = angle;

        for (let index = 0; index < segmentCount; index += 1) {
            heading = fractureTurn(heading, random, volatility);
            const step = reach / segmentCount * (stepMinimum + random() * stepVariance);
            const nextX = clamp(x + Math.cos(heading) * step, -10, canvasWidth + 10);
            const nextY = clamp(y + Math.sin(heading) * step, -10, canvasHeight + 10);

            if (Math.hypot(nextX - x, nextY - y) < 1) {
                break;
            }

            const result = appendCrackStep(
                points,
                { x, y },
                { x: nextX, y: nextY },
                random,
                colliders,
                null,
                roughness
            );
            x = result.x;
            y = result.y;

            if (result.stopped) {
                break;
            }
        }

        return {
            points,
            weight,
            seed: Math.floor(random() * 0xffffffff),
            extendable: false,
            visibleFrom: 0,
            visibleTo: points.length - 1,
            startedAt: now + startDelay + random() * startDelayVariance,
            duration: duration + random() * durationVariance
        };
    }

    function createBranch(origin, angle, reach, random, now, colliders) {
        return createSecondaryPath(
            origin,
            angle,
            reach,
            random,
            now,
            colliders,
            SECONDARY_PATH_STYLES.branch
        );
    }

    function createHairline(origin, angle, reach, random, now, colliders) {
        return createSecondaryPath(
            origin,
            angle,
            reach,
            random,
            now,
            colliders,
            SECONDARY_PATH_STYLES.hairline
        );
    }

    function createRootPath(root, random, now, colliders) {
        const points = [{ x: root.x, y: root.y }];
        const branches = [];
        const minimumDimension = Math.min(window.innerWidth, window.innerHeight);
        const reach = minimumDimension * (0.18 + random() * 0.2);
        const segmentCount = 3 + Math.floor(random() * 5);
        let heading = root.angle + (random() - 0.5) * 1.38;
        let x = root.x;
        let y = root.y;
        let stopped = false;
        let branchCreated = false;
        let hairlineCreated = false;
        const branchSites = [];

        for (let segment = 0; segment < segmentCount; segment += 1) {
            heading = fractureTurn(heading, random, 0.92);
            const step = reach / segmentCount * (0.28 + random() * 1.52);
            const nextX = clamp(x + Math.cos(heading) * step, -12, canvasWidth + 12);
            const nextY = clamp(y + Math.sin(heading) * step, -12, canvasHeight + 12);

            if (Math.hypot(nextX - x, nextY - y) < 1) {
                break;
            }

            const result = appendCrackStep(
                points,
                { x, y },
                { x: nextX, y: nextY },
                random,
                colliders,
                null,
                0.085
            );
            x = result.x;
            y = result.y;
            stopped = result.stopped;

            if (!branchCreated && segment > 0 && segment < segmentCount - 1 && random() < 0.28) {
                branchSites.push({ x, y, heading, kind: 'branch' });
                branchCreated = true;
            }

            if (!hairlineCreated && segment > 0 && random() < 0.18) {
                branchSites.push({ x, y, heading, kind: 'hairline' });
                hairlineCreated = true;
            }

            if (stopped) {
                break;
            }
        }

        const path = {
            points,
            weight: 1,
            seed: Math.floor(random() * 0xffffffff),
            heading,
            primary: true,
            extendable: !stopped,
            visibleFrom: 0,
            visibleTo: points.length - 1,
            startedAt: now + random() * 90,
            duration: 340 + random() * 130
        };
        const localColliders = [...colliders, path];

        branchSites.forEach((site) => {
            const direction = random() < 0.5 ? -1 : 1;
            const branch = site.kind === 'branch'
                ? createBranch(
                    site,
                    site.heading + direction * (0.48 + random() * 0.78),
                    reach * (0.08 + random() * 0.14),
                    random,
                    now,
                    localColliders
                )
                : createHairline(
                    site,
                    site.heading + direction * (0.4 + random() * 0.9),
                    7 + random() * 21,
                    random,
                    now,
                    localColliders
                );

            if (branch.points.length > 1) {
                branches.push(branch);
                localColliders.push(branch);
            }
        });

        return { path, branches };
    }

    function createFracture(thumbnail, clickX, clickY, order, thumbnailOrder, now) {
        const rect = pageRect(thumbnail);
        const seed = Math.floor(Math.random() * 0xffffffff) ^ (order * 2654435761);
        const random = seededRandom(seed);
        const nearestRoot = closestBorderPoint(rect, clickX, clickY);
        const anchorProgress = borderProgress(rect, nearestRoot);
        const existingPaths = allPaths();
        const existingPrimaryCount = pathsForThumbnail(thumbnail)
            .filter((path) => path.primary).length;
        const availablePrimaryCracks = Math.max(
            0,
            MAX_PRIMARY_CRACKS_PER_THUMBNAIL - existingPrimaryCount
        );
        const desiredRootCount = thumbnailOrder === 1
            ? 2 + Math.floor(random() * 2)
            : 1 + (random() < 0.18 ? 1 : 0);
        const rootCount = Math.min(desiredRootCount, availablePrimaryCracks);
        const paths = [];
        const colliders = [...existingPaths];

        for (let index = 0; index < rootCount; index += 1) {
            const root = index === 0
                ? nearestRoot
                : borderPointAt(rect, anchorProgress + (random() - 0.5) * 0.52);
            const result = createRootPath(root, random, now, colliders);
            paths.push(result.path, ...result.branches);
            colliders.push(result.path, ...result.branches);
        }

        return {
            thumbnail,
            anchorX: rect.left + rect.width / 2,
            anchorY: rect.top + rect.height / 2,
            paths,
            seed
        };
    }

    function currentVisibleSegments(path, now) {
        if (reducedMotion.matches) {
            return path.visibleTo;
        }

        const rawProgress = clamp((now - path.startedAt) / path.duration, 0, 1);
        const progress = 1 - Math.pow(1 - rawProgress, 3);
        return path.visibleFrom + (path.visibleTo - path.visibleFrom) * progress;
    }

    function extendExistingFractures(now, clickOrder) {
        const random = seededRandom(
            Math.floor(Math.random() * 0xffffffff) ^ (clickOrder * 2246822519)
        );
        const newBranches = [];
        const colliders = allPaths();
        const candidates = impacts
            .flatMap((impact) => impact.paths.map((path) => ({ impact, path })))
            .filter(({ path }) => path.extendable && path.points.length >= 2)
            .map((candidate) => ({ ...candidate, score: random() }))
            .sort((first, second) => first.score - second.score);
        const selected = candidates.slice(0, random() < 0.18 ? 2 : 1);

        selected.forEach(({ impact, path }) => {
            const visibleBeforeExtension = currentVisibleSegments(path, now);
            const oldEnd = path.points[path.points.length - 1];
            const previous = path.points[path.points.length - 2];
            let heading = path.heading ?? Math.atan2(oldEnd.y - previous.y, oldEnd.x - previous.x);
            let x = oldEnd.x;
            let y = oldEnd.y;
            const extensionCount = 1 + Math.floor(random() * 3);
            const stepBase = Math.min(window.innerWidth, window.innerHeight) * (0.045 + random() * 0.045);
            const previousPointCount = path.points.length;
            let stopped = false;

            for (let segment = 0; segment < extensionCount; segment += 1) {
                heading = fractureTurn(heading, random, 0.88);
                const step = stepBase * (0.32 + random() * 1.38);
                const nextX = clamp(x + Math.cos(heading) * step, -12, canvasWidth + 12);
                const nextY = clamp(y + Math.sin(heading) * step, -12, canvasHeight + 12);

                if (Math.hypot(nextX - x, nextY - y) < 1) {
                    break;
                }

                const result = appendCrackStep(
                    path.points,
                    { x, y },
                    { x: nextX, y: nextY },
                    random,
                    colliders,
                    path,
                    0.085
                );
                x = result.x;
                y = result.y;
                stopped = result.stopped;

                if (!stopped && random() < 0.2) {
                    const direction = random() < 0.5 ? -1 : 1;
                    const branch = createBranch(
                        { x, y },
                        heading + direction * (0.46 + random() * 0.82),
                        stepBase * (0.42 + random() * 0.72),
                        random,
                        now,
                        colliders
                    );
                    newBranches.push({ impact, path: branch });
                    colliders.push(branch);
                }

                if (!stopped && random() < 0.12) {
                    const direction = random() < 0.5 ? -1 : 1;
                    const hairline = createHairline(
                        { x, y },
                        heading + direction * (0.38 + random() * 0.92),
                        7 + random() * 22,
                        random,
                        now,
                        colliders
                    );
                    newBranches.push({ impact, path: hairline });
                    colliders.push(hairline);
                }

                if (stopped) {
                    path.extendable = false;
                    break;
                }
            }

            if (path.points.length > previousPointCount) {
                path.visibleFrom = visibleBeforeExtension;
                path.visibleTo = path.points.length - 1;
                path.startedAt = now;
                path.duration = 430 + random() * 130;
                path.heading = heading;
            }
        });

        newBranches.forEach(({ impact, path }) => {
            if (path.points.length > 1) {
                impact.paths.push(path);
            }
        });
    }

    // Canvas rendering --------------------------------------------------------

    function forEachVisibleSegment(points, visibleSegments, callback) {
        if (points.length < 2 || visibleSegments <= 0) {
            return;
        }

        const maximumSegments = points.length - 1;
        const clampedSegments = Math.min(maximumSegments, visibleSegments);
        const completeSegments = Math.floor(clampedSegments);
        const partialSegment = clampedSegments - completeSegments;
        const segmentLimit = Math.ceil(clampedSegments);

        for (let index = 0; index < segmentLimit; index += 1) {
            const start = points[index];
            const sourceEnd = points[index + 1];
            const fraction = index < completeSegments ? 1 : partialSegment;

            if (!sourceEnd || fraction <= 0) {
                continue;
            }

            callback(start, {
                x: start.x + (sourceEnd.x - start.x) * fraction,
                y: start.y + (sourceEnd.y - start.y) * fraction
            }, index, maximumSegments);
        }
    }

    function strokeSegmentLayer(path, visibleSegments, options) {
        forEachVisibleSegment(path.points, visibleSegments, (start, end, index, segmentCount) => {
            const position = (index + 0.5) / Math.max(1, segmentCount);
            const taper = 1 - position * 0.62;
            const widthVariation = 0.72 + segmentNoise(path.seed, index) * 0.56;
            const brightness = segmentNoise(path.seed ^ options.noiseSeed, index);
            const visibility = segmentNoise(path.seed ^ options.visibilitySeed, index);

            if (visibility > options.coverage) {
                return;
            }

            const alpha = options.alpha * (0.34 + brightness * 0.66) * path.weight;

            context.beginPath();
            context.moveTo(start.x + options.offsetX, start.y + options.offsetY);
            context.lineTo(end.x + options.offsetX, end.y + options.offsetY);
            context.strokeStyle = `rgba(${options.color}, ${alpha})`;
            context.lineWidth = Math.max(
                options.minimumWidth,
                options.width * taper * widthVariation * path.weight
            );
            context.lineCap = 'round';
            context.stroke();
        });
    }

    function strokeCrack(path, visibleSegments) {
        CRACK_LAYERS.forEach((layer) => {
            strokeSegmentLayer(path, visibleSegments, layer);
        });
    }

    function draw(now) {
        animationFrame = 0;
        context.clearRect(0, 0, canvasWidth, canvasHeight);
        const wallClockNow = Date.now();

        if (repairDeadline && wallClockNow >= repairDeadline && !repairStartedAt) {
            repairStartedAt = repairDeadline;
        }

        const repairRaw = repairStartedAt
            ? (reducedMotion.matches
                ? 1
                : clamp((wallClockNow - repairStartedAt) / REPAIR_DURATION_MS, 0, 1))
            : 0;
        const repairProgress = repairRaw * repairRaw * (3 - 2 * repairRaw);
        let needsAnotherFrame = repairRaw > 0 && repairRaw < 1;

        impacts.forEach((impact) => {
            context.save();
            context.globalAlpha = 1 - repairProgress;

            impact.paths.forEach((path) => {
                const visibleSegments = currentVisibleSegments(path, now);
                strokeCrack(path, visibleSegments * (1 - repairProgress));

                if (visibleSegments < path.visibleTo - 0.002) {
                    needsAnotherFrame = true;
                }
            });

            context.restore();
        });

        if (repairRaw >= 1) {
            impacts.length = 0;
            repairDeadline = 0;
            repairStartedAt = 0;
        }

        if (needsAnotherFrame) {
            requestDraw();
        }
    }

    function requestDraw() {
        if (!animationFrame) {
            animationFrame = requestAnimationFrame(draw);
        }
    }

    // Layout synchronization --------------------------------------------------

    function realignImpacts() {
        impacts.forEach((impact) => {
            const rect = pageRect(impact.thumbnail);
            const nextAnchorX = rect.left + rect.width / 2;
            const nextAnchorY = rect.top + rect.height / 2;
            const deltaX = nextAnchorX - impact.anchorX;
            const deltaY = nextAnchorY - impact.anchorY;

            if (Math.abs(deltaX) < 0.01 && Math.abs(deltaY) < 0.01) {
                return;
            }

            impact.paths.forEach((path) => {
                path.points.forEach((point) => {
                    point.x += deltaX;
                    point.y += deltaY;
                });
            });
            impact.anchorX = nextAnchorX;
            impact.anchorY = nextAnchorY;
        });
    }

    function resize() {
        const root = document.documentElement;
        const body = document.body;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvasWidth = Math.max(window.innerWidth, root.scrollWidth, body.scrollWidth);
        canvasHeight = Math.max(window.innerHeight, root.scrollHeight, body.scrollHeight);
        canvas.width = Math.round(canvasWidth * dpr);
        canvas.height = Math.round(canvasHeight * dpr);
        canvas.style.width = `${canvasWidth}px`;
        canvas.style.height = `${canvasHeight}px`;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        realignImpacts();
        requestDraw();
    }

    // Earthquake animation ----------------------------------------------------

    function triggerQuake(thumbnail, x, y) {
        if (reducedMotion.matches || typeof thumbnail.animate !== 'function') {
            return;
        }

        quakeAnimations.forEach((animation) => animation.cancel());
        quakeAnimations = [];
        const power = Math.min(1.85, 0.9 + impacts.length * 0.1);
        const maximumDistance = Math.hypot(window.innerWidth, window.innerHeight);

        quakeTargets.forEach((target, index) => {
            const rect = pageRect(target);
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const deltaX = centerX - x;
            const deltaY = centerY - y;
            const distance = Math.max(1, Math.hypot(deltaX, deltaY));
            const random = seededRandom((index + 1) * 7919 + impacts.length * 104729);
            const fallbackAngle = random() * Math.PI * 2;
            const unitX = distance < 12 ? Math.cos(fallbackAngle) : deltaX / distance;
            const unitY = distance < 12 ? Math.sin(fallbackAngle) : deltaY / distance;
            const perpendicularX = -unitY;
            const perpendicularY = unitX;
            const falloff = 0.3 + 0.7 * (1 - Math.min(1, distance / maximumDistance));
            const amplitude = 11 * power * falloff;
            const delay = Math.min(210, distance * 0.18);
            const rotation = (random() - 0.5) * 0.42 * power;

            const animation = target.animate([
                { transform: 'translate3d(0, 0, 0) rotate(0)', offset: 0 },
                {
                    transform: `translate3d(${unitX * amplitude + perpendicularX * amplitude * 0.32}px, ${unitY * amplitude + perpendicularY * amplitude * 0.32}px, 0) rotate(${rotation}deg)`,
                    offset: 0.17
                },
                {
                    transform: `translate3d(${-unitX * amplitude * 0.62 + perpendicularX * amplitude * 0.22}px, ${-unitY * amplitude * 0.62 + perpendicularY * amplitude * 0.22}px, 0) rotate(${-rotation * 0.72}deg)`,
                    offset: 0.36
                },
                {
                    transform: `translate3d(${unitX * amplitude * 0.4 - perpendicularX * amplitude * 0.16}px, ${unitY * amplitude * 0.4 - perpendicularY * amplitude * 0.16}px, 0) rotate(${rotation * 0.45}deg)`,
                    offset: 0.56
                },
                {
                    transform: `translate3d(${-unitX * amplitude * 0.18}px, ${-unitY * amplitude * 0.18}px, 0) rotate(${-rotation * 0.18}deg)`,
                    offset: 0.78
                },
                { transform: 'translate3d(0, 0, 0) rotate(0)', offset: 1 }
            ], {
                duration: 720,
                delay,
                easing: 'linear'
            });

            quakeAnimations.push(animation);
        });

        const previousTimer = thumbnailTimers.get(thumbnail);
        window.clearTimeout(previousTimer);
        thumbnail.classList.remove('is-epicenter');
        void thumbnail.offsetWidth;
        thumbnail.classList.add('is-epicenter');
        thumbnailTimers.set(thumbnail, window.setTimeout(() => {
            thumbnail.classList.remove('is-epicenter');
        }, 760));
    }

    // Wall-clock repair lifecycle --------------------------------------------

    function beginRepair() {
        if (!repairDeadline) {
            return;
        }

        if (Date.now() < repairDeadline) {
            repairTimer = window.setTimeout(beginRepair, repairDeadline - Date.now());
            return;
        }

        repairStartedAt = repairDeadline;
        requestDraw();
    }

    function reconcileRepairClock() {
        if (!repairDeadline) {
            return;
        }

        window.clearTimeout(repairTimer);

        if (Date.now() >= repairDeadline) {
            beginRepair();
            return;
        }

        repairTimer = window.setTimeout(beginRepair, repairDeadline - Date.now());
    }

    function scheduleRepair() {
        window.clearTimeout(repairTimer);
        repairDeadline = Date.now() + REPAIR_DELAY_MS;
        repairStartedAt = 0;
        repairTimer = window.setTimeout(beginRepair, REPAIR_DELAY_MS);
    }

    // Interaction -------------------------------------------------------------

    function fractureAt(thumbnail, clickX, clickY) {
        const now = performance.now();
        const order = impacts.length + 1;
        const thumbnailOrder = impacts.filter((impact) => impact.thumbnail === thumbnail).length + 1;

        extendExistingFractures(now, order);
        impacts.push(createFracture(thumbnail, clickX, clickY, order, thumbnailOrder, now));

        const rect = pageRect(thumbnail);
        triggerQuake(thumbnail, rect.left + rect.width / 2, rect.top + rect.height / 2);
        scheduleRepair();
        requestDraw();
    }

    function pointFromClick(thumbnail, event) {
        const rect = pageRect(thumbnail);
        const hasPointerPosition = event.clientX !== 0 || event.clientY !== 0;

        return hasPointerPosition
            ? {
                x: event.clientX + window.scrollX,
                y: event.clientY + window.scrollY
            }
            : {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
            };
    }

    function registerThumbnail(thumbnail) {
        thumbnail.tabIndex = 0;
        thumbnail.setAttribute('role', 'button');
        thumbnail.setAttribute('aria-label', 'Trigger an accumulating earthquake crack');

        thumbnail.addEventListener('click', (event) => {
            const point = pointFromClick(thumbnail, event);
            fractureAt(thumbnail, point.x, point.y);
        });

        thumbnail.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }

            event.preventDefault();
            const rect = pageRect(thumbnail);
            fractureAt(thumbnail, rect.left + rect.width / 2, rect.top + rect.height / 2);
        });
    }

    thumbnails.forEach(registerThumbnail);

    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('focus', reconcileRepairClock);
    window.addEventListener('pageshow', reconcileRepairClock);
    document.addEventListener('visibilitychange', reconcileRepairClock);
    if ('ResizeObserver' in window) {
        new ResizeObserver(resize).observe(document.body);
    }
    resize();
})();
