// PocketBase integration
const PocketBase = require('pocketbase');
const pb = new PocketBase('http://your-pocketbase-url');

// Function to update app_usage
async function updateAppUsage(data) {
    await pb.collection('app_usage').update(data.id, data);
}

// Function to get system snapshots
async function getSystemSnapshots() {
    return await pb.collection('system_snapshots').getFullList();
}

// Function to create a new session
async function createSession(data) {
    await pb.collection('sessions').create(data);
}

// Function to update goals
async function updateGoal(data) {
    await pb.collection('goals').update(data.id, data);
}

// Function to log pomodoro
async function logPomodoro(data) {
    await pb.collection('pomodoro_log').create(data);
}

// Example usage of the functions
(async () => {
    const appUsageData = { id: 'exampleId', usage: 100 };
    await updateAppUsage(appUsageData);
    const snapshots = await getSystemSnapshots();
    console.log(snapshots);
    await createSession({ userId: 'exampleUser', status: 'active' });
    await updateGoal({ id: 'goalId', progress: 50 });
    await logPomodoro({ sessionId: 'sessionId', duration: 25 });
})();