import { Mutex } from 'async-mutex'

const AVAILABLE_FLAGS = {
    'away': 1,
    'longAway': 2,
    'overPressure': 3,
    'maxHeating': 6,
    'maxCooling': 7,
    'manualBoost': 10,
    'summerNightCooling': 12,
}

// Modes that can only be true one at a time (mapped to their coil number)
const MUTUALLY_EXCLUSIVE_MODES = {
    'away': 1,
    'longAway': 2,
    'overPressure': 3,
    'maxHeating': 6,
    'maxCooling': 7,
    'manualBoost': 10,
}

const AVAILABLE_SETTINGS = {
    'overPressureDelay': 57,
    'awayVentilationLevel': 100,
    'awayTemperatureReduction': 101,
    'longAwayVentilationLevel': 102,
    'longAwayTemperatureReduction': 103,
    'temperatureTarget': 135,
}

const mutex = new Mutex()

export const parseTemperature = (temperature) => {
    if (temperature > 60000) {
        temperature = (65536 - temperature) * -1
    }

    return temperature / 10
}

export const getFlagSummary = async (modbusClient) => {
    let result = await mutex.runExclusive(async () => modbusClient.readCoils(1, 10))
    let summary = {
        'away': result.data[0],
        'longAway': result.data[1],
        'overPressure': result.data[2],
        'maxHeating': result.data[5],
        'maxCooling': result.data[6],
        'manualBoost': result.data[9],
    }

    result = await mutex.runExclusive(async () => modbusClient.readCoils(12, 1))
    summary = {
        ...summary,
        'summerNightCooling': result.data[0]
    }

    return summary
}

export const getFlag = async (modbusClient, flag) => {
    if (AVAILABLE_FLAGS[flag] === undefined) {
        throw new Error('Unknown flag')
    }

    const result = await mutex.runExclusive(async () => modbusClient.readCoils(AVAILABLE_FLAGS[flag], 1))

    return result.data[0]
}

export const setFlag = async (modbusClient, flag, value) => {
    if (AVAILABLE_FLAGS[flag] === undefined) {
        throw new Error('Unknown flag')
    }

    await mutex.runExclusive(async () => modbusClient.writeCoil(AVAILABLE_FLAGS[flag], value))

    // Flags are mutually exclusive, disable all others when enabling one
    if (value) {
        await disableAllModesExcept(modbusClient, flag)
    }
}

const disableAllModesExcept = async (modbusClient, exceptedMode) => {
    for (const mode in MUTUALLY_EXCLUSIVE_MODES) {
        if (mode === exceptedMode) {
            continue
        }

        await mutex.runExclusive(async () => modbusClient.writeCoil(AVAILABLE_FLAGS[mode], false))
    }
}

export const getReadings = async (modbusClient) => {
    let result = await mutex.runExclusive(async () => modbusClient.readHoldingRegisters(6, 8))
    let readings = {
        'freshAirTemperature': parseTemperature(result.data[0]),
        'supplyAirTemperatureAfterHeatRecovery': parseTemperature(result.data[1]),
        'supplyAirTemperature': parseTemperature(result.data[2]),
        'wasteAirTemperature': parseTemperature(result.data[3]),
        'exhaustAirTemperature': parseTemperature(result.data[4]),
        'exhaustAirTemperatureBeforeHeatRecovery': parseTemperature(result.data[5]),
        'exhaustAirHumidity': result.data[7],
    }

    result = await mutex.runExclusive(async () => modbusClient.readHoldingRegisters(29, 7))
    readings = {
        ...readings,
        'heatRecoverySupplySide': result.data[0],
        'heatRecoveryExhaustSide': result.data[1],
        'heatRecoveryTemperatureDifferenceSupplySide': parseTemperature(result.data[2]),
        'heatRecoveryTemperatureDifferenceExhaustSide': parseTemperature(result.data[3]),
        'mean48HourExhaustHumidity': result.data[6],
    }

    result = await mutex.runExclusive(async () => modbusClient.readHoldingRegisters(47, 3))
    readings = {
        ...readings,
        'cascadeSp': result.data[0],
        'cascadeP': result.data[1],
        'cascadeI': result.data[2],
    }

    result = await mutex.runExclusive(async () => modbusClient.readHoldingRegisters(56, 1))
    readings = {
        ...readings,
        'overPressureTimeLeft': result.data[0],
    }

    result = await mutex.runExclusive(async () => modbusClient.readHoldingRegisters(50, 4))
    readings = {
        ...readings,
        'ventilationLevelActual': result.data[0],
        'ventilationLevelTarget': result.data[3],
    }

    return readings
}

export const getSettings = async (modbusClient) => {
    let result = await mutex.runExclusive(async () => modbusClient.readHoldingRegisters(57, 1))
    let settings = {
        'overPressureDelay': result.data[0]
    }

    result = await mutex.runExclusive(async () => modbusClient.readHoldingRegisters(100, 4))
    settings = {
        ...settings,
        'awayVentilationLevel': result.data[0],
        'awayTemperatureReduction': parseTemperature(result.data[1]),
        'longAwayVentilationLevel': result.data[2],
        'longAwayTemperatureReduction': parseTemperature(result.data[3]),
    }

    result = await mutex.runExclusive(async () => modbusClient.readHoldingRegisters(135, 1))
    settings = {
        ...settings,
        'temperatureTarget': parseTemperature(result.data[0])
    }

    return settings
}

export const setSetting = async (modbusClient, setting, value) => {
    if (AVAILABLE_SETTINGS[setting] === undefined) {
        throw new Error('Unknown setting')
    }

    let intValue = parseInt(value, 10)

    switch (setting) {
        case 'awayVentilationLevel':
        case 'longAwayVentilationLevel':
            if (intValue < 20 || intValue > 100) {
                throw new RangeError('level out of range')
            }

            break
        case 'temperatureTarget':
            if (intValue < 10 || intValue > 30) {
                throw new RangeError('temperature out of range')
            }

            intValue *= 10
            break
        case 'overPressureDelay':
            if (intValue < 0 || intValue > 60) {
                throw new RangeError('delay out of range')
            }

            break
        case 'awayTemperatureReduction':
        case 'longAwayTemperatureReduction':
            // No minimum/maximum values specified in the register documentation
            intValue *= 10
            break
    }

    await mutex.runExclusive(async () => modbusClient.writeRegister(AVAILABLE_SETTINGS[setting], intValue))
}

export const getDeviceInformation = async (modbusClient) => {
    let result = await mutex.runExclusive(async () => modbusClient.readCoils(16, 1))
    let deviceInformation = {
        // EC means DC motors
        'fanType': result.data[0] ? 'EC' : 'AC',
    }

    result = await mutex.runExclusive(async () => modbusClient.readHoldingRegisters(154, 1))
    deviceInformation = {
        ...deviceInformation,
        'coolingTypeInstalled': getCoolingTypeName(result.data[0])
    }

    result = await mutex.runExclusive(async () => modbusClient.readHoldingRegisters(171, 1))
    deviceInformation = {
        ...deviceInformation,
        'heatingTypeInstalled': getHeatingTypeName(result.data[0])
    }

    result = await mutex.runExclusive(async () => modbusClient.readHoldingRegisters(597, 3))
    deviceInformation = {
        ...deviceInformation,
        'familyType': getDeviceFamilyName(result.data[0]),
        'serialNumber': result.data[1],
        'softwareVersion': result.data[2] / 100
    }

    return deviceInformation
}

const getDeviceFamilyName = (familyTypeInt) => {
    return [
        'Pingvin',
        'Pandion',
        'Pelican',
        'Pegasos',
        'Pegasos XL',
        'LTR-3',
        'LTR-6̈́',
        'LTR-7',
        'LTR-7 XL'
    ][familyTypeInt] ?? 'unknown'
}

const getCoolingTypeName = (coolingTypeInt) => {
    // 0=Ei jäähdytintä, 1=CW, 2=HP, 3=CG, 4=CX, 5=CX_INV, 6=X2CX, 7=CXBIN, 8=Cooler
    return [
        null,
        'CW',
        'HP',
        'CG',
        'CX',
        'CX_INV',
        'X2CX',
        'CXBIN',
        'Cooler',
    ][coolingTypeInt]
}

const getHeatingTypeName = (heatingTypeInt) => {
    // 0=Ei lämmitintä, 1=VPK, 2=HP, 3=SLP, 4=SLP PWM. Mapping known values to the actual names used on the product,
    // these seem to be internal
    return [
        'ED',
        'EDW',
        'HP',
        'EDE',
        'SLP PWM',
    ][heatingTypeInt] ?? 'unknown'
}

export const createModelNameString = (deviceInformation) => {
    // E.g. LTR-3 eco EDE - CG
    let modelName = deviceInformation.familyType

    if (deviceInformation.fanType === 'EC') {
        modelName += ' eco'
    }

    if (deviceInformation.heatingTypeInstalled !== null) {
        modelName += ` ${deviceInformation.heatingTypeInstalled}`
    }

    if (deviceInformation.coolingTypeInstalled !== null) {
        modelName += ` - ${deviceInformation.coolingTypeInstalled}`
    }

    return modelName
}
