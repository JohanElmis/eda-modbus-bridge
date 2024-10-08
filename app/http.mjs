import {
    getDeviceInformation,
    getMode as modbusGetMode,
    getModeSummary,
    getReadings,
    getSettings,
    setMode as modbusSetMode,
    setSetting as modbusSetSetting,
    acknowledgeAlarm as modbusAcknowledgeAlarm,
    getDeviceState,
    getNewestAlarm,
    getAlarmSummary,
} from './modbus.mjs'
import { createLogger } from './logger.mjs'

const logger = createLogger('http')

const root = async (req, res) => {
    res.send('eda-modbus-bridge')
}

const summary = async (modbusClient, req, res) => {
    try {
        let modeSummary = await getModeSummary(modbusClient)
        const newestAlarm = await getNewestAlarm(modbusClient)

        const summary = {
            // TODO: Remove in next major version
            'flags': modeSummary,
            'modes': modeSummary,
            'readings': await getReadings(modbusClient),
            'settings': await getSettings(modbusClient),
            'deviceInformation': await getDeviceInformation(modbusClient),
            'deviceState': await getDeviceState(modbusClient),
            'alarmSummary': await getAlarmSummary(modbusClient),
            'activeAlarm': newestAlarm?.state === 2 ? newestAlarm : null,
        }

        res.json(summary)
    } catch (e) {
        handleError(e, res)
    }
}

const getMode = async (modbusClient, req, res) => {
    try {
        const mode = req.params['mode']
        const status = await modbusGetMode(modbusClient, mode)

        res.json({
            'active': status,
        })
    } catch (e) {
        handleError(e, res)
    }
}

const setMode = async (modbusClient, req, res) => {
    try {
        const mode = req.params['mode']
        const status = !!req.body['active']

        logger.info(`Setting mode ${mode} to ${status}`)

        await modbusSetMode(modbusClient, mode, status)

        res.json({
            'active': await modbusGetMode(modbusClient, mode),
        })
    } catch (e) {
        handleError(e, res)
    }
}

const setSetting = async (modbusClient, req, res) => {
    try {
        const setting = req.params['setting']
        const value = req.params['value']

        logger.info(`Setting setting ${setting} to ${value}`)

        await modbusSetSetting(modbusClient, setting, value)

        res.json({
            'settings': await getSettings(modbusClient),
        })
    } catch (e) {
        if (e instanceof RangeError) {
            handleError(e, res, 400)
        } else {
            handleError(e, res)
        }
    }
}

const acknowledgeAlarm = async (modbusClient, req, res) => {
    try {
        logger.info('Acknowledging currently active alarm (if any)')

        await modbusAcknowledgeAlarm(modbusClient)
    } catch (e) {
        handleError(e, res)
    }
}

export const configureRoutes = (httpServer, modbusClient) => {
    httpServer.get('/', root)
    httpServer.get('/summary', (req, res) => {
        return summary(modbusClient, req, res)
    })
    httpServer.get('/mode/:mode', (req, res) => {
        return getMode(modbusClient, req, res)
    })
    httpServer.post('/mode/:mode', (req, res) => {
        return setMode(modbusClient, req, res)
    })
    httpServer.post('/setting/:setting/:value', (req, res) => {
        return setSetting(modbusClient, req, res)
    })
    httpServer.post('/alarm/acknowledge', (req, res) => {
        return acknowledgeAlarm(modbusClient, req, res)
    })
}

const handleError = (e, res, statusCode = undefined) => {
    logger.error(`An exception occurred: ${e.name}: ${e.message}`, e.stack)
    // Use HTTP 500 if no status code has been set
    res.status(statusCode ?? 500)
    res.json({
        error: e.name,
        message: e.message,
    })
}
